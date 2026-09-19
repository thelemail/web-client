import { describe, expect, it } from 'vitest';
import { buildRecoveryKitPdf, toWinAnsi, wrapText } from './kit-pdf';

const WORDS = [
	'harbor',
	'velvet',
	'orbit',
	'canvas',
	'mirror',
	'timber',
	'saddle',
	'jungle',
	'quantum',
	'meadow',
	'anchor',
	'pilot'
];

function kit(overrides: Partial<Parameters<typeof buildRecoveryKitPdf>[0]> = {}) {
	return new TextDecoder().decode(
		buildRecoveryKitPdf({
			words: WORDS,
			email: 'gargantua@thelemail.com',
			created: '19 September 2026',
			text: {
				eyebrow: 'Thelemail recovery kit',
				title: 'Your recovery phrase',
				accountLabel: 'Account',
				createdLabel: 'Created',
				phraseHeading: 'Twelve words, in order',
				sections: [
					{ heading: 'Keep it safe', body: 'Don’t email it (or photograph it) \\ ever.' }
				],
				footer: 'Generated on your device.'
			},
			...overrides
		})
	);
}

function hex(s: string): string {
	return (
		'<' +
		toWinAnsi(s)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase() +
		'>'
	);
}

describe('buildRecoveryKitPdf', () => {
	it('produces a well-formed single-page PDF', () => {
		const pdf = kit();
		expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
		expect(pdf.endsWith('%%EOF\n')).toBe(true);
		expect(pdf).toContain('/Type /Page ');
		expect(pdf).toContain('/Count 1');
	});

	it('points every xref entry at its object', () => {
		const pdf = kit();
		const startxref = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
		expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
		const entries = pdf
			.slice(startxref)
			.split('\n')
			.filter((l) => / 00000 n $/.test(l))
			.map((l) => Number(l.slice(0, 10)));
		expect(entries).toHaveLength(8);
		entries.forEach((off, i) => {
			expect(pdf.slice(off).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
		});
	});

	it('declares the exact content stream length', () => {
		const pdf = kit();
		const m = pdf.match(/<< \/Length (\d+) >>\nstream\n/)!;
		const start = m.index! + m[0].length;
		const end = pdf.indexOf('\nendstream', start);
		expect(end - start).toBe(Number(m[1]));
	});

	it('carries all twelve words in order with their account', () => {
		const pdf = kit();
		let from = 0;
		for (const w of WORDS) {
			const at = pdf.indexOf(hex(w), from);
			expect(at).toBeGreaterThan(-1);
			from = at;
		}
		expect(pdf).toContain(hex('gargantua@thelemail.com'));
	});

	it('keeps text out of the page syntax so parentheses and backslashes are inert', () => {
		const pdf = kit();
		expect(pdf).not.toContain('(or photograph it)');
		expect(pdf).toContain(hex('Don’t email it (or photograph it) \\ ever.'));
	});

	it('is plain ASCII on the wire', () => {
		const bytes = buildRecoveryKitPdf({
			words: WORDS,
			email: 'ünïcödé@thelemail.com',
			created: '19. September 2026',
			text: {
				eyebrow: 'É',
				title: 'Wiederherstellung — Sicherheit',
				accountLabel: 'Konto',
				createdLabel: 'Erstellt',
				phraseHeading: 'Zwölf Wörter',
				sections: [],
				footer: '…'
			}
		});
		expect(bytes.every((b) => b < 0x80)).toBe(true);
	});
});

describe('toWinAnsi', () => {
	it('maps Latin-1 and typographic punctuation, and replaces the rest', () => {
		expect(toWinAnsi('é’—…')).toEqual([0xe9, 0x92, 0x97, 0x85]);
		expect(toWinAnsi('✓')).toEqual([0x3f]);
	});
});

describe('wrapText', () => {
	it('breaks long prose within the width and loses no words', () => {
		const text = 'Anyone who has these words can unlock your mail. '.repeat(6).trim();
		const lines = wrapText(text, 'F1', 10, 200);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(' ')).toBe(text);
	});
});
