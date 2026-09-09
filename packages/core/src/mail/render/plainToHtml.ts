const ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

const URL_RE = /\bhttps?:\/\/[^\s<>'")\]]+/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

interface Token {
	kind: 'text' | 'link';
	value: string;
	href?: string;
}

function linkify(escaped: string): string {
	const tokens: Token[] = [];
	let lastIdx = 0;
	for (const m of escaped.matchAll(URL_RE)) {
		if (m.index === undefined) continue;
		if (m.index > lastIdx) tokens.push({ kind: 'text', value: escaped.slice(lastIdx, m.index) });
		tokens.push({ kind: 'link', value: m[0], href: m[0] });
		lastIdx = m.index + m[0].length;
	}
	if (lastIdx < escaped.length) tokens.push({ kind: 'text', value: escaped.slice(lastIdx) });

	const expanded: Token[] = [];
	for (const t of tokens) {
		if (t.kind !== 'text') {
			expanded.push(t);
			continue;
		}
		let cursor = 0;
		for (const m of t.value.matchAll(EMAIL_RE)) {
			if (m.index === undefined) continue;
			if (m.index > cursor) expanded.push({ kind: 'text', value: t.value.slice(cursor, m.index) });
			expanded.push({ kind: 'link', value: m[0], href: `mailto:${m[0]}` });
			cursor = m.index + m[0].length;
		}
		if (cursor < t.value.length) expanded.push({ kind: 'text', value: t.value.slice(cursor) });
	}

	return expanded
		.map((t) =>
			t.kind === 'link'
				? `<a href="${t.href}" target="_blank" rel="noopener noreferrer">${t.value}</a>`
				: t.value
		)
		.join('');
}

export function plainToHtml(text: string): string {
	const escaped = escapeHtml(text);
	const linked = linkify(escaped);
	const paragraphs = linked
		.split(/\r?\n\r?\n+/)
		.map((p) => `<p>${p.replace(/\r?\n/g, '<br>')}</p>`)
		.join('');
	return paragraphs || '<p></p>';
}
