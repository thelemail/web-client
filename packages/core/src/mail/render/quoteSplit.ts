export type SplitKind = 'quoted' | 'forwarded' | 'none';

export interface QuoteSplitResult {
	kind: SplitKind;
	mainHtml: string;
	quotedHtml?: string;
}

type CandidateKind = 'container' | 'blockquote' | 'header';

const CONTAINER_SELECTOR =
	'.gmail_quote, .gmail_quote_container, .protonmail_quote, .yahoo_quoted, blockquote[type="cite" i]';

const HEADER_SELECTOR = '[id$="divRplyFwdMsg"], [id$="appendonsend"], .OutlookMessageHeader';

const MEDIA_SELECTOR = 'img, video, audio, svg, canvas, iframe, object, embed';

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'TITLE', 'HEAD']);

const BLOCK_TAGS = new Set([
	'ADDRESS',
	'ARTICLE',
	'ASIDE',
	'BLOCKQUOTE',
	'CENTER',
	'DD',
	'DIV',
	'DL',
	'DT',
	'FIELDSET',
	'FIGURE',
	'FOOTER',
	'FORM',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HEADER',
	'HR',
	'LI',
	'MAIN',
	'NAV',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'TABLE',
	'TBODY',
	'TD',
	'TFOOT',
	'TH',
	'THEAD',
	'TR',
	'UL'
]);

const ATTRIBUTION_PATTERNS = [
	/^(?:On|Le|Am|El|Em|Den|Op|Il|W dniu)\b.{1,300}\b(?:wrote|a écrit|schrieb|escribió|escreveu|skrev|schreef|ha scritto|napisał\(a\)|napisała|napisał)\s*:$/i,
	/^.{1,300}\s(?:пишет|написал\(а\)|написала|написал)\s*:$/i
];

const FORWARDED_RE =
	/^[ \t>]*(?:-{3,}\s*(?:Forwarded message|Message transféré|Weitergeleitete Nachricht|Mensaje reenviado|Mensagem encaminhada|Inoltrato|Pesan diteruskan|Пересылаемое сообщение|Сообщение пересл)|Begin forwarded message\s*:)/im;

const ORIGINAL_MESSAGE_RE =
	/^-{2,}\s*(?:Original Message|Ursprüngliche Nachricht|Message d'origine|Mensaje original|Mensagem original|Исходное сообщение)\s*-{2,}$/i;

const HEADER_FROM_RE = /^\*?(?:From|Von|De|От)\s*:\*?\s*\S/i;

const HEADER_FIELD_RE = /^\*?(?:Sent|Date|Gesendet|Datum|Envoyé|Enviado|Enviada|Отправлено|Дата)\s*:/i;

const HEADER_START_RE = /^\s*(?:-|\*?(?:From|Von|De|От)\s*:)/i;

const QUOTE_LINE_RE = /^\s*>/;

const SIGNATURE_RE = /^-- ?$/;

function collapse(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function isAttribution(s: string): boolean {
	const line = collapse(s);
	if (!line || line.length > 400) return false;
	return ATTRIBUTION_PATTERNS.some((re) => re.test(line));
}

function isHeaderAt(lines: string[], i: number): boolean {
	const line = lines[i].trim();
	if (ORIGINAL_MESSAGE_RE.test(line)) return true;
	if (!HEADER_FROM_RE.test(line)) return false;
	for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
		if (HEADER_FIELD_RE.test(lines[j].trim())) return true;
	}
	return false;
}

function firstLine(s: string): string {
	return s.split('\n').find((l) => l.trim()) ?? '';
}

function blockText(node: Node): string {
	let out = '';
	const walk = (n: Node) => {
		if (n.nodeType === Node.TEXT_NODE) {
			out += n.nodeValue ?? '';
			return;
		}
		if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
		const tag = (n as Element).tagName;
		if (tag && SKIP_TAGS.has(tag)) return;
		if (tag === 'BR') {
			out += '\n';
			return;
		}
		const block = !!tag && BLOCK_TAGS.has(tag);
		if (block) out += '\n';
		n.childNodes.forEach(walk);
		if (block) out += '\n';
	};
	walk(node);
	return out;
}

function hasContent(node: Node): boolean {
	if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').trim() !== '';
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	const el = node as Element;
	if (SKIP_TAGS.has(el.tagName)) return false;
	if (el.matches(MEDIA_SELECTOR)) return true;
	return Array.from(el.childNodes).some(hasContent);
}

function nothingAfter(node: Node, root: Node): boolean {
	for (let cur: Node | null = node; cur && cur !== root; cur = cur.parentNode) {
		for (let s = cur.nextSibling; s; s = s.nextSibling) {
			if (hasContent(s)) return false;
		}
	}
	return true;
}

function isHeaderElement(el: Element): boolean {
	if (el.tagName !== 'DIV' && el.tagName !== 'P') return false;
	if (!HEADER_START_RE.test(el.textContent ?? '')) return false;
	const lines = blockText(el)
		.split('\n')
		.filter((l) => l.trim());
	return lines.length > 0 && isHeaderAt(lines, 0);
}

function candidateKind(el: Element): CandidateKind | null {
	if (el.matches(CONTAINER_SELECTOR)) return 'container';
	if (el.matches(HEADER_SELECTOR)) return 'header';
	if (el.tagName === 'BLOCKQUOTE') return 'blockquote';
	if (isHeaderElement(el)) return 'header';
	return null;
}

function findAttribution(before: Node | null): Node | null {
	let p = before;
	while (p && !hasContent(p)) p = p.previousSibling;
	if (!p) return null;
	const text = blockText(p);
	if (isAttribution(text)) return p;
	let q = p.previousSibling;
	while (q && !hasContent(q)) q = q.previousSibling;
	if (q && isAttribution(`${blockText(q)} ${text}`)) return q;
	if (p.nodeType === Node.ELEMENT_NODE) return findAttribution(p.lastChild);
	return null;
}

function trimTrailing(node: Node): void {
	while (node.lastChild) {
		const last = node.lastChild;
		if (last.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has((last as Element).tagName)) return;
		if (!hasContent(last)) {
			last.remove();
			continue;
		}
		if (last.nodeType === Node.ELEMENT_NODE) trimTrailing(last);
		return;
	}
}

function findQuoteStart(body: HTMLElement): Node | null {
	const examined: Element[] = [];
	for (const el of Array.from(body.querySelectorAll('*'))) {
		if (examined.some((e) => e.contains(el))) continue;
		const kind = candidateKind(el);
		if (!kind) continue;
		examined.push(el);
		if (kind === 'header') return findAttribution(el.previousSibling) ?? el;
		if (!nothingAfter(el, body)) continue;
		const attribution = findAttribution(el.previousSibling);
		if (kind === 'blockquote' && !attribution) continue;
		return attribution ?? el;
	}
	return null;
}

export function splitQuotedHtml(html: string): QuoteSplitResult {
	if (typeof DOMParser === 'undefined') return { kind: 'none', mainHtml: html };
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const body = doc.body;

	const styleEls = Array.from(doc.querySelectorAll('style'));
	const styles = styleEls.map((s) => s.outerHTML).join('');
	styleEls.forEach((s) => s.remove());

	const start = findQuoteStart(body);
	if (!start) {
		return { kind: FORWARDED_RE.test(blockText(body)) ? 'forwarded' : 'none', mainHtml: html };
	}

	const range = doc.createRange();
	range.setStartBefore(start);
	range.setEndAfter(body.lastChild!);
	const holder = doc.createElement('div');
	holder.appendChild(range.extractContents());
	trimTrailing(body);

	if (FORWARDED_RE.test(blockText(body)) || FORWARDED_RE.test(firstLine(blockText(holder)))) {
		return { kind: 'forwarded', mainHtml: html };
	}
	if (!hasContent(body)) return { kind: 'none', mainHtml: html };

	return { kind: 'quoted', mainHtml: styles + body.innerHTML, quotedHtml: styles + holder.innerHTML };
}

function trailingQuoteCut(lines: string[]): number {
	let i = lines.length - 1;
	while (i >= 0 && !lines[i].trim()) i--;
	if (i >= 0 && !QUOTE_LINE_RE.test(lines[i])) {
		let sig = i;
		while (sig >= 0 && !SIGNATURE_RE.test(lines[sig]) && !QUOTE_LINE_RE.test(lines[sig])) sig--;
		if (sig < 0 || !SIGNATURE_RE.test(lines[sig])) return -1;
		i = sig - 1;
		while (i >= 0 && !lines[i].trim()) i--;
	}
	if (i < 0 || !QUOTE_LINE_RE.test(lines[i])) return -1;

	let start = i;
	for (let k = i - 1; k >= 0; k--) {
		if (QUOTE_LINE_RE.test(lines[k])) start = k;
		else if (lines[k].trim()) break;
	}

	let a = start - 1;
	while (a >= 0 && !lines[a].trim()) a--;
	if (a < 0) return -1;
	if (isAttribution(lines[a])) return a;
	if (a > 0 && isAttribution(`${lines[a - 1]} ${lines[a]}`)) return a - 1;
	return -1;
}

function textCut(lines: string[]): number {
	const cuts = [trailingQuoteCut(lines), lines.findIndex((_, i) => isHeaderAt(lines, i))];
	const found = cuts.filter((c) => c > -1);
	return found.length ? Math.min(...found) : -1;
}

export function splitQuotedText(text: string): QuoteSplitResult {
	const lines = text.split(/\r?\n/);
	const cut = textCut(lines);
	if (cut === -1) return { kind: FORWARDED_RE.test(text) ? 'forwarded' : 'none', mainHtml: text };

	const main = lines.slice(0, cut).join('\n').trimEnd();
	const quoted = lines.slice(cut).join('\n');
	if (FORWARDED_RE.test(main) || FORWARDED_RE.test(firstLine(quoted))) {
		return { kind: 'forwarded', mainHtml: text };
	}
	if (!main.trim()) return { kind: 'none', mainHtml: text };

	return { kind: 'quoted', mainHtml: main, quotedHtml: quoted };
}
