import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, type ZipWriterAddDataOptions } from '@zip.js/zip.js/lib/zip-core-native.js';

export type ZipFiles = Record<string, string | Uint8Array>;

export async function zip(files: ZipFiles, options: ZipWriterAddDataOptions = {}): Promise<Uint8Array> {
	const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
	for (const [name, content] of Object.entries(files)) {
		await writer.add(name, typeof content === 'string' ? new TextReader(content) : new Uint8ArrayReader(content), options);
	}
	return new Uint8Array(await (await writer.close()).arrayBuffer());
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function rels(entries: { id: string; type: string; target: string; external?: boolean }[]): string {
	const body = entries
		.map((e) => `<Relationship Id="${e.id}" Type="${REL}/${e.type}" Target="${e.target}"${e.external ? ' TargetMode="External"' : ''}/>`)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_RELS}">${body}</Relationships>`;
}

function para(text: string): string {
	return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export function docxFiles(paragraphs: string[], extra: { header?: string; footnote?: string; comment?: string; external?: boolean } = {}): ZipFiles {
	const related: { id: string; type: string; target: string; external?: boolean }[] = [];
	const files: ZipFiles = {
		'[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
		'_rels/.rels': rels([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }])
	};
	if (extra.header) {
		related.push({ id: 'rId2', type: 'header', target: 'header1.xml' });
		files['word/header1.xml'] = `<w:hdr ${W}>${para(extra.header)}</w:hdr>`;
	}
	if (extra.footnote) {
		related.push({ id: 'rId3', type: 'footnotes', target: 'footnotes.xml' });
		files['word/footnotes.xml'] = `<w:footnotes ${W}><w:footnote>${para(extra.footnote)}</w:footnote></w:footnotes>`;
	}
	if (extra.comment) {
		related.push({ id: 'rId4', type: 'comments', target: 'comments.xml' });
		files['word/comments.xml'] = `<w:comments ${W}><w:comment>${para(extra.comment)}</w:comment></w:comments>`;
	}
	if (extra.external) related.push({ id: 'rId5', type: 'header', target: 'https://tracker.test/remote.xml', external: true });
	files['word/_rels/document.xml.rels'] = rels(related);
	files['word/document.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paragraphs.map(para).join('')}</w:body></w:document>`;
	return files;
}

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function xlsxFiles(sheets: { name: string; xml: string }[], shared: string[]): ZipFiles {
	const files: ZipFiles = {
		'[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
		'_rels/.rels': rels([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]),
		'xl/sharedStrings.xml': `<sst ${S}>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
		'xl/_rels/workbook.xml.rels': rels([
			{ id: 'rIdS', type: 'sharedStrings', target: 'sharedStrings.xml' },
			...sheets.map((s, i) => ({ id: `rId${i + 1}`, type: 'worksheet', target: `worksheets/sheet${i + 1}.xml` }))
		]),
		'xl/workbook.xml': `<workbook ${S}><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
	};
	sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet ${S}><sheetData>${s.xml}</sheetData></worksheet>`));
	return files;
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function pptxFiles(slides: { text: string; notes?: string }[]): ZipFiles {
	const files: ZipFiles = {
		'_rels/.rels': rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]),
		'ppt/_rels/presentation.xml.rels': rels(slides.map((_, i) => ({ id: `rId${i + 10}`, type: 'slide', target: `slides/slide${i + 1}.xml` }))),
		'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst>${slides
			.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
			.join('')}</p:sldIdLst></p:presentation>`
	};
	slides.forEach((s, i) => {
		files[`ppt/slides/slide${i + 1}.xml`] = `<p:sld ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${s.text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
		if (s.notes) {
			files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([{ id: 'rIdN', type: 'notesSlide', target: `../notesSlides/notesSlide${i + 1}.xml` }]);
			files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = `<p:notes ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${s.notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
		}
	});
	return files;
}

const O =
	'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';

export function odfFiles(kind: 'text' | 'spreadsheet' | 'presentation', body: string, manifest = ''): ZipFiles {
	return {
		mimetype: `application/vnd.oasis.opendocument.${kind}`,
		'META-INF/manifest.xml': `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">${manifest}</manifest:manifest>`,
		'content.xml': `<office:document-content ${O}><office:body><office:${kind}>${body}</office:${kind}></office:body></office:document-content>`
	};
}

export function pdf(pages: string[]): Uint8Array {
	const objects: string[] = [];
	const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
	objects.push('<< /Type /Catalog /Pages 2 0 R >>');
	objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
	objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	pages.forEach((text, i) => {
		const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
		objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	});
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}
