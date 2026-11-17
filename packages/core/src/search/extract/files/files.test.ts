import { describe, expect, it } from 'vitest';
import { FILE_LIMITS, FileWarning, extractFile, type FileLimits, type FileText } from './index';
import { docxFiles, odfFiles, pdf, pptxFiles, xlsxFiles, zip } from './fixtures';

const enc = (s: string) => new TextEncoder().encode(s);
const tick = () => undefined;

function run(bytes: Uint8Array, filename: string, mime = 'application/octet-stream', limits: Partial<FileLimits> = {}): Promise<FileText> {
	return extractFile({ bytes, filename, mime }, tick, { ...FILE_LIMITS, ...limits });
}

function places(r: FileText): string[] {
	return r.parts.map((p) => p.place);
}

function text(r: FileText): string {
	return r.parts.map((p) => p.text).join('\n');
}

describe('plain text family', () => {
	it('indexes text, csv and json as inert text with line provenance', async () => {
		const r = await run(enc('name,amount\nCalloway invoice,=SUM(A1:A9)\n'), 'ledger.csv', 'text/csv');
		expect(r.state).toBe('complete');
		expect(text(r)).toContain('Calloway invoice,=SUM(A1:A9)');
		expect(places(r)).toEqual(['lines:1-3']);
		const json = await run(enc('{"ref":"QX-4471"}'), 'data.json', 'application/json');
		expect(text(json)).toBe('{"ref":"QX-4471"}');
	});

	it('honours a BOM and a declared charset and falls back with a warning', async () => {
		const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('Grüße', (c) => [c.charCodeAt(0), 0]).flat()]);
		expect(text(await run(utf16, 'a.txt', 'text/plain'))).toBe('Grüße');
		const koi8 = new Uint8Array([0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4]);
		expect(text(await run(koi8, 'b.txt', 'text/plain; charset=koi8-r'))).toBe('Привет');
		const latin = await run(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'c.txt', 'text/plain');
		expect(text(latin)).toBe('café');
		expect(latin.warnings & FileWarning.charset).toBeTruthy();
	});

	it('reports binary content and unknown formats as unsupported', async () => {
		expect((await run(new Uint8Array([0, 1, 2, 3, 0, 0]), 'x.txt', 'text/plain')).state).toBe('unsupported');
		expect((await run(enc('GIF89a'), 'photo.gif', 'image/gif')).state).toBe('unsupported');
		expect((await run(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'old.doc', 'application/msword')).state).toBe('unsupported');
	});

	it('treats an OLE container named as OOXML as password protected', async () => {
		const r = await run(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'secret.xlsx');
		expect(r.state).toBe('password_required');
	});

	it('extracts html attachments without scripts or remote references', async () => {
		const r = await run(enc('<p>Board minutes</p><script>fetch("https://x.test")</script><img src="https://tracker.test/p.gif">'), 'm.html', 'text/html');
		expect(text(r)).toBe('Board minutes');
	});

	it('stops at the emitted text limit with partial state', async () => {
		const r = await run(enc('alpha beta gamma\n'.repeat(100)), 'big.txt', 'text/plain', { maxText: 64, maxPart: 32 });
		expect(r.state).toBe('partial');
		expect(r.parts.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(64);
	});
});

describe('DOCX', () => {
	it('reads body, headers, footnotes and comments with their places and ignores external relationships', async () => {
		const bytes = await zip(docxFiles(['Quarterly ledger for Calloway', 'Second paragraph'], { header: 'Confidential header', footnote: 'Footnote text', comment: 'Reviewer comment', external: true }));
		const r = await run(bytes, 'report.docx');
		expect(r.state).toBe('complete');
		expect(r.parts).toEqual([
			{ place: 'body', text: 'Quarterly ledger for Calloway\nSecond paragraph' },
			{ place: 'header:1', text: 'Confidential header' },
			{ place: 'footnotes', text: 'Footnote text' },
			{ place: 'comments', text: 'Reviewer comment' }
		]);
	});

	it('skips field codes and deleted text', async () => {
		const files = docxFiles([]);
		files['word/document.xml'] =
			'<w:document xmlns:w="w"><w:body><w:p><w:r><w:instrText>HYPERLINK "https://x.test"</w:instrText></w:r><w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:body></w:document>';
		expect(text(await run(await zip(files), 'f.docx'))).toBe('kept');
	});

	it('rejects DOCTYPE and entity declarations', async () => {
		const files = docxFiles([]);
		files['word/document.xml'] = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "https://x.test/e">]><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>';
		expect((await run(await zip(files), 'e.docx')).state).toBe('malformed');
	});

	it('stops at the XML depth limit', async () => {
		const files = docxFiles([]);
		files['word/document.xml'] = `<w:document xmlns:w="w">${'<w:b>'.repeat(200)}${'</w:b>'.repeat(200)}</w:document>`;
		expect((await run(await zip(files), 'deep.docx')).state).toBe('partial');
	});
});

describe('XLSX', () => {
	it('reads shared, inline and cached values with cell ranges and never formulas', async () => {
		const sheet =
			'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1250</v></c></row>' +
			'<row r="2"><c r="A2" t="inlineStr"><is><t>Inline note</t></is></c><c r="B2"><f>SUM(B1:B1)</f><v>1250</v></c><c r="C2"><f>NOW()</f></c></row>';
		const r = await run(await zip(xlsxFiles([{ name: 'Budget', xml: sheet }], ['Harbour lease'])), 'budget.xlsx');
		expect(r.state).toBe('complete');
		expect(r.parts).toEqual([
			{ place: 'sheet:Budget', text: 'Budget' },
			{ place: 'Budget!A1:B2', text: 'Harbour lease 1250\nInline note 1250' }
		]);
		expect(text(r)).not.toContain('SUM');
		expect(text(r)).not.toContain('NOW');
	});

	it('stops at the cell limit', async () => {
		const rows = Array.from({ length: 20 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
		const r = await run(await zip(xlsxFiles([{ name: 'S', xml: rows }], [])), 'cells.xlsx', 'application/octet-stream', { maxCells: 10 });
		expect(r.state).toBe('partial');
	});
});

describe('PPTX', () => {
	it('keeps slide order and notes per slide', async () => {
		const r = await run(await zip(pptxFiles([{ text: 'Roadmap' }, { text: 'Pricing', notes: 'Mention the discount' }])), 'deck.pptx');
		expect(r.parts).toEqual([
			{ place: 'slide:1', text: 'Roadmap' },
			{ place: 'slide:2', text: 'Pricing' },
			{ place: 'notes:2', text: 'Mention the discount' }
		]);
	});
});

describe('OpenDocument', () => {
	it('reads text, spreadsheet cells and presentation pages', async () => {
		const odt = await run(await zip(odfFiles('text', '<text:h>Title</text:h><text:p>Body<text:s text:c="2"/>text</text:p>')), 'a.odt');
		expect(odt.parts).toEqual([{ place: 'body', text: 'Title\nBody text' }]);
		const ods = await run(
			await zip(
				odfFiles(
					'spreadsheet',
					'<table:table table:name="Q1"><table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>7</text:p></table:table-cell></table:table-row></table:table>'
				)
			),
			'b.ods'
		);
		expect(ods.parts).toEqual([
			{ place: 'sheet:Q1', text: 'Q1' },
			{ place: 'Q1!A1:C1', text: 'North 7 7' }
		]);
		const odp = await run(
			await zip(odfFiles('presentation', '<draw:page><draw:frame><text:p>Intro</text:p></draw:frame><presentation:notes><text:p>Say hello</text:p></presentation:notes></draw:page>')),
			'c.odp'
		);
		expect(odp.parts).toEqual([
			{ place: 'slide:1', text: 'Intro' },
			{ place: 'notes:1', text: 'Say hello' }
		]);
	});

	it('reports encrypted documents as password required', async () => {
		const files = odfFiles('text', '', '<manifest:file-entry><manifest:encryption-data/></manifest:file-entry>');
		expect((await run(await zip(files), 'locked.odt')).state).toBe('password_required');
	});
});

describe('ZIP bounds', () => {
	it('stops on an excessive compression ratio', async () => {
		const files = docxFiles(['x']);
		files['word/document.xml'] = `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${'A'.repeat(4 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>`;
		expect((await run(await zip(files), 'bomb.docx')).state).toBe('partial');
	});

	it('stops when expanded content exceeds the budget', async () => {
		const r = await run(await zip(docxFiles(['some text'])), 'small.docx', 'application/octet-stream', { maxExpanded: 100 });
		expect(r.state).toBe('partial');
	});

	it('stops past the entry limit', async () => {
		const files = docxFiles(['x']);
		for (let i = 0; i < 30; i++) files[`word/media/${i}.bin`] = new Uint8Array([i]);
		expect((await run(await zip(files), 'many.docx', 'application/octet-stream', { maxEntries: 20 })).state).toBe('partial');
	});

	it('rejects traversal paths', async () => {
		const files = docxFiles(['x']);
		files['../../evil.xml'] = '<x/>';
		expect((await run(await zip(files), 'trav.docx')).state).toBe('malformed');
	});

	it('reports encrypted entries as password required', async () => {
		const bytes = await zip(docxFiles(['secret']), { password: 'calloway', encryptionStrength: 3 });
		expect((await run(bytes, 'enc.docx')).state).toBe('password_required');
	});

	it('reports unknown archives as unsupported', async () => {
		expect((await run(await zip({ 'a.txt': 'hello' }), 'bundle.zip', 'application/zip')).state).toBe('unsupported');
	});

	it('reports corrupt archives as malformed', async () => {
		const bytes = await zip(docxFiles(['x']));
		expect((await run(bytes.subarray(0, bytes.length - 30), 'cut.docx')).state).toBe('malformed');
	});
});

describe('PDF', () => {
	it('emits one part per page', async () => {
		const r = await run(pdf(['Invoice QX-4471', 'Payment terms']), 'invoice.pdf', 'application/pdf');
		expect(r.state).toBe('complete');
		expect(r.parts).toEqual([
			{ place: 'page:1', text: 'Invoice QX-4471' },
			{ place: 'page:2', text: 'Payment terms' }
		]);
	});

	it('stops at the page limit', async () => {
		const r = await run(pdf(['one', 'two', 'three']), 'long.pdf', 'application/pdf', { maxPages: 2 });
		expect(r.state).toBe('partial');
		expect(places(r)).toEqual(['page:1', 'page:2']);
	});

	it('reports a broken PDF as malformed', async () => {
		expect((await run(enc('%PDF-1.4\ngarbage'), 'broken.pdf', 'application/pdf')).state).toBe('malformed');
	});
});
