const SKIPPED = new Set(['script', 'style', 'head', 'template', 'noscript', 'svg', 'math', 'object', 'embed', 'iframe', 'frame', 'frameset', 'title', 'xml']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK = new Set([
	'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
	'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul'
]);
const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
	mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
	euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', middot: '·', bull: '•', shy: '',
	zwnj: '‌', zwj: '‍', times: '×', divide: '÷'
};
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i;
const MAX_DEPTH = 256;

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (whole, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
			return String.fromCodePoint(code);
		}
		const named = NAMED[body.toLowerCase()];
		return named ?? whole;
	});
}

interface Tag {
	name: string;
	closing: boolean;
	selfClosing: boolean;
	attrs: Map<string, string>;
	end: number;
}

function readTag(html: string, start: number): Tag | null {
	const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(start, start + 64));
	if (!m) return null;
	let i = start + m[0].length;
	const attrs = new Map<string, string>();
	const n = html.length;
	while (i < n) {
		while (i < n && /\s/.test(html[i])) i++;
		if (html[i] === '>') return { name: m[2].toLowerCase(), closing: m[1] === '/', selfClosing: false, attrs, end: i + 1 };
		if (html[i] === '/' && html[i + 1] === '>') return { name: m[2].toLowerCase(), closing: m[1] === '/', selfClosing: true, attrs, end: i + 2 };
		const nameStart = i;
		while (i < n && !/[\s=>/]/.test(html[i])) i++;
		const attr = html.slice(nameStart, i).toLowerCase();
		if (i === nameStart) {
			i++;
			continue;
		}
		while (i < n && /\s/.test(html[i])) i++;
		let value = '';
		if (html[i] === '=') {
			i++;
			while (i < n && /\s/.test(html[i])) i++;
			const q = html[i];
			if (q === '"' || q === "'") {
				const close = html.indexOf(q, i + 1);
				const stop = close === -1 ? n : close;
				value = html.slice(i + 1, stop);
				i = stop + 1;
			} else {
				const vs = i;
				while (i < n && !/[\s>]/.test(html[i])) i++;
				value = html.slice(vs, i);
			}
		}
		if (!attrs.has(attr)) attrs.set(attr, decodeEntities(value));
	}
	return null;
}

function hidden(tag: Tag): boolean {
	if (tag.attrs.has('hidden')) return true;
	const style = tag.attrs.get('style');
	return !!style && HIDDEN_STYLE.test(style);
}

function linkTarget(href: string | undefined): string | null {
	if (!href) return null;
	const trimmed = href.trim();
	return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

function tidy(text: string): string {
	return text
		.replace(/[ \t\f\v ]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function htmlToText(html: string): string {
	const out: string[] = [];
	const skip: string[] = [];
	const anchors: { href: string | null; start: number }[] = [];
	let i = 0;
	const n = html.length;
	while (i < n) {
		const lt = html.indexOf('<', i);
		const textEnd = lt === -1 ? n : lt;
		if (textEnd > i && skip.length === 0) out.push(decodeEntities(html.slice(i, textEnd)).replace(/\s+/g, ' '));
		if (lt === -1) break;
		if (html.startsWith('<!--', lt)) {
			const close = html.indexOf('-->', lt + 4);
			i = close === -1 ? n : close + 3;
			continue;
		}
		if (html[lt + 1] === '!' || html[lt + 1] === '?') {
			const close = html.indexOf('>', lt);
			i = close === -1 ? n : close + 1;
			continue;
		}
		const tag = readTag(html, lt);
		if (!tag) {
			if (skip.length === 0) out.push('<');
			i = lt + 1;
			continue;
		}
		i = tag.end;
		if (skip.length > 0) {
			if (tag.closing && tag.name === skip[skip.length - 1]) skip.pop();
			else if (!tag.closing && !tag.selfClosing && !VOID.has(tag.name) && tag.name === skip[skip.length - 1] && skip.length < MAX_DEPTH) skip.push(tag.name);
			continue;
		}
		if (!tag.closing && !tag.selfClosing && !VOID.has(tag.name) && (SKIPPED.has(tag.name) || hidden(tag))) {
			skip.push(tag.name);
			continue;
		}
		if (tag.name === 'a') {
			if (!tag.closing) {
				anchors.push({ href: linkTarget(tag.attrs.get('href')), start: out.length });
			} else {
				const a = anchors.pop();
				if (a?.href) {
					const visible = out.slice(a.start).join('').trim();
					const bare = a.href.replace(/^mailto:/i, '');
					if (visible !== a.href && visible !== bare) out.push(` ${a.href} `);
				}
			}
			continue;
		}
		if (tag.name === 'img' && !tag.closing) {
			const alt = tag.attrs.get('alt');
			if (alt) out.push(` ${alt} `);
			continue;
		}
		if (BLOCK.has(tag.name)) out.push('\n');
		else if (tag.name === 'td' || tag.name === 'th') out.push(' ');
	}
	return tidy(out.join(''));
}
