export interface RecoveryKitText {
	eyebrow: string;
	title: string;
	accountLabel: string;
	createdLabel: string;
	phraseHeading: string;
	sections: { heading: string; body: string }[];
	footer: string;
}

export interface RecoveryKitInput {
	words: string[];
	email: string;
	created: string;
	text: RecoveryKitText;
}

type FontKey = 'F1' | 'F2' | 'F3';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '0.071 0.078 0.055';
const MUTED = '0.416 0.447 0.373';
const PINE = '0.125 0.251 0.188';
const RULE = '0.835 0.816 0.753';
const CELL = '0.965 0.957 0.933';

const HELVETICA =
	'278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584';
const HELVETICA_BOLD =
	'278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584';

const WIDTHS: Record<FontKey, number[]> = {
	F1: HELVETICA.split(',').map(Number),
	F2: HELVETICA_BOLD.split(',').map(Number),
	F3: []
};

const WIN_ANSI_EXTRA: Record<number, number> = {
	0x20ac: 0x80,
	0x201a: 0x82,
	0x0192: 0x83,
	0x201e: 0x84,
	0x2026: 0x85,
	0x2020: 0x86,
	0x2021: 0x87,
	0x02c6: 0x88,
	0x2030: 0x89,
	0x0160: 0x8a,
	0x2039: 0x8b,
	0x0152: 0x8c,
	0x017d: 0x8e,
	0x2018: 0x91,
	0x2019: 0x92,
	0x201c: 0x93,
	0x201d: 0x94,
	0x2022: 0x95,
	0x2013: 0x96,
	0x2014: 0x97,
	0x02dc: 0x98,
	0x2122: 0x99,
	0x0161: 0x9a,
	0x203a: 0x9b,
	0x0153: 0x9c,
	0x017e: 0x9e,
	0x0178: 0x9f,
	0x202f: 0x20,
	0x2009: 0x20
};

export function toWinAnsi(text: string): number[] {
	const out: number[] = [];
	for (const ch of text.normalize('NFC')) {
		const cp = ch.codePointAt(0)!;
		if (cp >= 0x20 && cp <= 0x7e) out.push(cp);
		else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
		else if (WIN_ANSI_EXTRA[cp] !== undefined) out.push(WIN_ANSI_EXTRA[cp]);
		else out.push(0x3f);
	}
	return out;
}

function hexString(text: string): string {
	return (
		'<' +
		toWinAnsi(text)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase() +
		'>'
	);
}

function textWidth(text: string, font: FontKey, size: number): number {
	if (font === 'F3') return toWinAnsi(text).length * 600 * (size / 1000);
	const table = WIDTHS[font];
	let units = 0;
	for (const b of toWinAnsi(text)) {
		units += b >= 0x20 && b <= 0x7e ? table[b - 0x20] : 556;
	}
	return units * (size / 1000);
}

export function wrapText(text: string, font: FontKey, size: number, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if (line && textWidth(next, font, size) > maxWidth) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function n(v: number): string {
	return Number(v.toFixed(2)).toString();
}

class Canvas {
	ops: string[] = [];

	text(x: number, y: number, str: string, font: FontKey, size: number, color = INK) {
		this.ops.push(`BT ${color} rg /${font} ${n(size)} Tf ${n(x)} ${n(y)} Td ${hexString(str)} Tj ET`);
	}

	rect(x: number, y: number, w: number, h: number, fill: string, stroke: string) {
		this.ops.push(`${fill} rg ${stroke} RG 0.75 w ${n(x)} ${n(y)} ${n(w)} ${n(h)} re B`);
	}

	line(x1: number, y1: number, x2: number, y2: number, color = RULE) {
		this.ops.push(`${color} RG 0.75 w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
	}
}

function drawPage(input: RecoveryKitInput): string {
	const { words, email, created, text } = input;
	const c = new Canvas();
	let y = PAGE_H - MARGIN;

	c.text(MARGIN, y - 9, text.eyebrow.toUpperCase(), 'F2', 8.5, PINE);
	y -= 40;
	c.text(MARGIN, y, text.title, 'F2', 22);
	y -= 30;

	const labelW = Math.max(
		textWidth(text.accountLabel, 'F1', 10),
		textWidth(text.createdLabel, 'F1', 10)
	);
	c.text(MARGIN, y, text.accountLabel, 'F1', 10, MUTED);
	c.text(MARGIN + labelW + 14, y, email, 'F2', 10);
	y -= 16;
	c.text(MARGIN, y, text.createdLabel, 'F1', 10, MUTED);
	c.text(MARGIN + labelW + 14, y, created, 'F1', 10);
	y -= 24;
	c.line(MARGIN, y, PAGE_W - MARGIN, y);
	y -= 30;

	c.text(MARGIN, y, text.phraseHeading, 'F2', 11);
	y -= 16;

	const cols = 3;
	const gap = 8;
	const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
	const cellH = 34;
	words.forEach((word, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = MARGIN + col * (cellW + gap);
		const top = y - row * (cellH + gap);
		c.rect(x, top - cellH, cellW, cellH, CELL, RULE);
		const num = String(i + 1);
		c.text(x + 22 - textWidth(num, 'F1', 8), top - cellH / 2 - 3, num, 'F1', 8, MUTED);
		c.text(x + 30, top - cellH / 2 - 4.5, word, 'F3', 13, PINE);
	});
	y -= Math.ceil(words.length / cols) * (cellH + gap) + 22;

	for (const section of text.sections) {
		c.text(MARGIN, y, section.heading, 'F2', 11);
		y -= 16;
		for (const l of wrapText(section.body, 'F1', 10, CONTENT_W)) {
			c.text(MARGIN, y, l, 'F1', 10);
			y -= 14.5;
		}
		y -= 12;
	}

	c.line(MARGIN, MARGIN + 18, PAGE_W - MARGIN, MARGIN + 18);
	c.text(MARGIN, MARGIN, text.footer, 'F1', 8.5, MUTED);
	return c.ops.join('\n');
}

export function buildRecoveryKitPdf(input: RecoveryKitInput): Uint8Array {
	const content = drawPage(input);
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`,
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
		`<< /Title ${hexString(input.text.title)} >>`
	];
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}
