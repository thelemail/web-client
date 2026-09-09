export type SplitKind = 'quoted' | 'forwarded' | 'none';

export interface QuoteSplitResult {
	kind: SplitKind;
	mainHtml: string;
	quotedHtml?: string;
}

const QUOTE_CLASSES = [
	'gmail_quote',
	'gmail_attr',
	'protonmail_quote',
	'yahoo_quoted',
	'outlook',
	'appleMailQuote',
	'OutlookMessageHeader'
];

const ATTRIBUTION_RE =
	/(?:^|\s)(?:On|Le|Am|El|On a|Den|Op|Den|Il|W dniu)\b.{1,200}\b(?:wrote|a écrit|schrieb|escribió|skrev|schreef|ha scritto|napisał\(a\))\s*:/i;

const FORWARDED_RE =
	/^[ \t>]*-{3,}\s*(?:Forwarded message|Begin forwarded message|Message transféré|Weitergeleitete Nachricht|Mensaje reenviado|Inoltrato|Pesan diteruskan|D[oO]:|Сообщение пересл)/im;

function hasQuoteClass(el: Element): boolean {
	const cls = (el.getAttribute('class') ?? '').toLowerCase();
	if (!cls) return false;
	return QUOTE_CLASSES.some((q) => cls.includes(q.toLowerCase()));
}

function textLength(html: string): number {
	if (typeof DOMParser === 'undefined') return html.length;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

function elementTextLength(el: Element): number {
	return (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

function detectAttributionNear(target: Element): boolean {
	let n = 0;
	let cur: Element | null = target.previousElementSibling;
	while (cur && n < 2) {
		const txt = (cur.textContent ?? '').trim();
		if (ATTRIBUTION_RE.test(txt)) return true;
		cur = cur.previousElementSibling;
		n++;
	}
	const firstChild = target.firstElementChild;
	if (firstChild) {
		const txt = (firstChild.textContent ?? '').trim().split(/\r?\n/)[0] ?? '';
		if (ATTRIBUTION_RE.test(txt)) return true;
	}
	const ownTxt = (target.textContent ?? '').trim().split(/\r?\n/)[0] ?? '';
	if (ATTRIBUTION_RE.test(ownTxt)) return true;
	return false;
}

export function splitQuotedHtml(html: string): QuoteSplitResult {
	if (typeof DOMParser === 'undefined') return { kind: 'none', mainHtml: html };
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const body = doc.body;

	if (FORWARDED_RE.test(body.textContent ?? '')) {
		return { kind: 'forwarded', mainHtml: html };
	}

	const children = Array.from(body.children);
	let candidate: Element | null = null;
	for (let i = children.length - 1; i >= 0; i--) {
		const el = children[i];
		if (el.tagName === 'BLOCKQUOTE') {
			candidate = el;
			break;
		}
		if (hasQuoteClass(el)) {
			candidate = el;
			break;
		}
		const inner = el.querySelector('blockquote, .gmail_quote, .protonmail_quote, .yahoo_quoted');
		if (inner && el.children.length <= 2) {
			candidate = inner;
			break;
		}
	}
	if (!candidate) return { kind: 'none', mainHtml: html };

	if (!detectAttributionNear(candidate)) return { kind: 'none', mainHtml: html };

	const total = elementTextLength(body);
	const quoted = elementTextLength(candidate);
	if (total === 0 || quoted / total >= 0.8) return { kind: 'none', mainHtml: html };

	const quotedHtml = candidate.outerHTML;
	let toRemove: Element = candidate;
	let parent = candidate.parentElement;
	while (
		parent &&
		parent !== body &&
		parent.children.length === 1 &&
		(parent.textContent ?? '').trim() === (candidate.textContent ?? '').trim()
	) {
		toRemove = parent;
		parent = parent.parentElement;
	}
	toRemove.remove();

	return { kind: 'quoted', mainHtml: body.innerHTML, quotedHtml };
}

export function splitQuotedText(text: string): QuoteSplitResult {
	if (FORWARDED_RE.test(text)) return { kind: 'forwarded', mainHtml: text };

	const lines = text.split(/\r?\n/);
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^[\s]*>/.test(lines[i])) {
			let j = i;
			while (j < lines.length && /^[\s]*>/.test(lines[j])) j++;
			if (j - i >= 2) {
				start = i;
				break;
			}
		}
	}
	if (start === -1) return { kind: 'none', mainHtml: text };

	const window = lines.slice(Math.max(0, start - 2), start).join(' ').trim();
	if (!ATTRIBUTION_RE.test(window)) return { kind: 'none', mainHtml: text };

	const main = lines.slice(0, start).join('\n').trimEnd();
	const quoted = lines.slice(start).join('\n');
	const mainLen = main.replace(/\s+/g, ' ').trim().length;
	const quotedLen = quoted.replace(/\s+/g, ' ').trim().length;
	const total = mainLen + quotedLen;
	if (total === 0 || quotedLen / total >= 0.8) return { kind: 'none', mainHtml: text };

	return { kind: 'quoted', mainHtml: main, quotedHtml: quoted };
}

export const _internal = { textLength, hasQuoteClass };
