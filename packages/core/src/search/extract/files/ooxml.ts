import { Chunker, Stop, type Sink } from './sink';
import { attr, walkXml } from './xml';
import type { Package } from './zip';

export type OoxmlKind = 'docx' | 'xlsx' | 'pptx';

interface Rel {
	id: string;
	type: string;
	target: string;
}

function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i + 1);
}

function resolve(base: string, target: string): string {
	const parts = (target.startsWith('/') ? target.slice(1) : dirOf(base) + target).split('/');
	const out: string[] = [];
	for (const p of parts) {
		if (p === '..') out.pop();
		else if (p && p !== '.') out.push(p);
	}
	return out.join('/');
}

function relsPath(part: string): string {
	return `${dirOf(part)}_rels/${part.slice(dirOf(part).length)}.rels`;
}

async function rels(pkg: Package, sink: Sink, part: string): Promise<Rel[]> {
	const bytes = await pkg.read(relsPath(part));
	if (!bytes) return [];
	const out: Rel[] = [];
	walkXml(bytes, sink, {
		open(name, a) {
			if (name !== 'Relationship' || !a.Id || !a.Target) return;
			if ((a.TargetMode ?? '').toLowerCase() === 'external') return;
			out.push({ id: a.Id, type: a.Type ?? '', target: resolve(part, a.Target) });
		},
		close() {},
		text() {}
	});
	return out;
}

function typed(list: Rel[], suffix: string): Rel[] {
	return list.filter((r) => r.type.endsWith(`/${suffix}`));
}

export function ooxmlKindOf(pkg: Package): OoxmlKind | null {
	if (pkg.has('word/document.xml')) return 'docx';
	if (pkg.has('xl/workbook.xml')) return 'xlsx';
	if (pkg.has('ppt/presentation.xml')) return 'pptx';
	return null;
}

async function mainPart(pkg: Package, sink: Sink, fallback: string): Promise<string> {
	const root = typed(await rels(pkg, sink, ''), 'officeDocument')[0];
	return root && pkg.has(root.target) ? root.target : fallback;
}

function paragraphs(bytes: Uint8Array, sink: Sink, place: string, textTags: ReadonlySet<string>, paraTags: ReadonlySet<string>, skip: ReadonlySet<string>): void {
	const chunks = new Chunker(sink, place);
	let line = '';
	let inText = 0;
	let skipping = 0;
	walkXml(bytes, sink, {
		open(name) {
			if (skip.has(name)) skipping++;
			else if (textTags.has(name)) inText++;
			else if (!skipping && (name === 'tab' || name === 'ptab')) line += '\t';
			else if (!skipping && (name === 'br' || name === 'cr')) line += '\n';
		},
		close(name) {
			if (skip.has(name)) skipping--;
			else if (textTags.has(name)) inText--;
			else if (paraTags.has(name) && !skipping) {
				chunks.line(line);
				line = '';
			}
		},
		text(t) {
			if (inText > 0 && skipping === 0) line += t;
		}
	});
	chunks.line(line);
	chunks.flush();
}

const DOCX_TEXT = new Set(['t']);
const DOCX_PARA = new Set(['p']);
const DOCX_SKIP = new Set(['instrText', 'delText', 'delInstrText']);

async function docx(pkg: Package, sink: Sink): Promise<void> {
	const main = await mainPart(pkg, sink, 'word/document.xml');
	const related = await rels(pkg, sink, main);
	const body = await pkg.read(main);
	if (!body) throw new Stop('malformed');
	paragraphs(body, sink, 'body', DOCX_TEXT, DOCX_PARA, DOCX_SKIP);
	const extra: [string, string][] = [];
	typed(related, 'header').forEach((r, i) => extra.push([r.target, `header:${i + 1}`]));
	typed(related, 'footer').forEach((r, i) => extra.push([r.target, `footer:${i + 1}`]));
	for (const r of typed(related, 'footnotes')) extra.push([r.target, 'footnotes']);
	for (const r of typed(related, 'endnotes')) extra.push([r.target, 'endnotes']);
	for (const r of typed(related, 'comments')) extra.push([r.target, 'comments']);
	for (const [path, place] of extra) {
		const bytes = await pkg.read(path);
		if (bytes) paragraphs(bytes, sink, place, DOCX_TEXT, DOCX_PARA, DOCX_SKIP);
	}
}

function column(ref: string): number {
	let n = 0;
	for (const ch of ref) {
		const c = ch.charCodeAt(0);
		if (c < 65 || c > 90) break;
		n = n * 26 + (c - 64);
	}
	return n;
}

export function cellName(col: number, row: number): string {
	let name = '';
	for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return `${name}${row}`;
}

export function sheetPlace(sheet: string, from: string, to: string): string {
	return from === to ? `${sheet}!${from}` : `${sheet}!${from}:${to}`;
}

export class RowChunks {
	#sink: Sink;
	#sheet: string;
	#lines: string[] = [];
	#length = 0;
	#first = '';
	#last = '';

	constructor(sink: Sink, sheet: string) {
		this.#sink = sink;
		this.#sheet = sheet;
	}

	row(cells: { ref: string; text: string }[]): void {
		const values = cells.filter((c) => c.text.trim());
		if (values.length === 0) return;
		const line = values.map((c) => c.text).join('\t');
		if (this.#length > 0 && this.#length + line.length > this.#sink.limits.maxPart) this.flush();
		if (this.#lines.length === 0) this.#first = values[0].ref;
		this.#last = values[values.length - 1].ref;
		this.#lines.push(line);
		this.#length += line.length + 1;
	}

	flush(): void {
		if (this.#lines.length === 0) return;
		const text = this.#lines.join('\n');
		this.#lines = [];
		this.#length = 0;
		this.#sink.add(sheetPlace(this.#sheet, this.#first, this.#last), text);
	}
}

async function sharedStrings(pkg: Package, sink: Sink, path: string | undefined): Promise<string[]> {
	const bytes = path ? await pkg.read(path) : null;
	if (!bytes) return [];
	const out: string[] = [];
	let current = '';
	let inItem = false;
	let inText = 0;
	let phonetic = 0;
	walkXml(bytes, sink, {
		open(name) {
			if (name === 'si') {
				inItem = true;
				current = '';
			} else if (name === 'rPh') phonetic++;
			else if (name === 't') inText++;
		},
		close(name) {
			if (name === 'si') {
				out.push(current);
				inItem = false;
			} else if (name === 'rPh') phonetic--;
			else if (name === 't') inText--;
		},
		text(t) {
			if (inItem && inText > 0 && phonetic === 0) current += t;
		}
	});
	return out;
}

function sheetCells(bytes: Uint8Array, sink: Sink, sheet: string, strings: readonly string[], counter: { cells: number }): void {
	const rows = new RowChunks(sink, sheet);
	let cells: { ref: string; text: string }[] = [];
	let rowIndex = 0;
	let cell: { ref: string; type: string } | null = null;
	let value = '';
	let target: 'v' | 'is' | null = null;
	let inT = 0;
	let nextCol = 1;
	walkXml(bytes, sink, {
		open(name, a) {
			if (name === 'row') {
				rowIndex = Number(a.r) || rowIndex + 1;
				cells = [];
				nextCol = 1;
			} else if (name === 'c') {
				if (++counter.cells > sink.limits.maxCells) throw new Stop('partial');
				const ref = a.r && /^[A-Z]+[0-9]+$/.test(a.r) ? a.r : cellName(nextCol, rowIndex);
				nextCol = column(ref) + 1;
				cell = { ref, type: a.t ?? 'n' };
				value = '';
				target = null;
			} else if (cell && name === 'v') target = 'v';
			else if (cell && name === 'is') target = 'is';
			else if (cell && target === 'is' && name === 't') inT++;
		},
		close(name) {
			if (name === 'c' && cell) {
				let text = '';
				if (cell.type === 's') text = strings[Number(value)] ?? '';
				else if (cell.type === 'inlineStr' || cell.type === 'str' || cell.type === 'n' || cell.type === 'd') text = value;
				cells.push({ ref: cell.ref, text });
				cell = null;
			} else if (name === 'row') {
				rows.row(cells);
				cells = [];
			} else if (name === 'v' || name === 'is') target = null;
			else if (name === 't' && inT > 0) inT--;
		},
		text(t) {
			if (!cell) return;
			if (target === 'v' || (target === 'is' && inT > 0)) value += t;
		}
	});
	rows.flush();
}

async function xlsx(pkg: Package, sink: Sink): Promise<void> {
	const main = await mainPart(pkg, sink, 'xl/workbook.xml');
	const related = await rels(pkg, sink, main);
	const byId = new Map(related.map((r) => [r.id, r]));
	const strings = await sharedStrings(pkg, sink, typed(related, 'sharedStrings')[0]?.target);
	const workbook = await pkg.read(main);
	if (!workbook) throw new Stop('malformed');
	const sheets: { name: string; target: string }[] = [];
	walkXml(workbook, sink, {
		open(name, a) {
			if (name !== 'sheet') return;
			const rel = byId.get(attr(a, 'id', true) ?? '');
			if (rel) sheets.push({ name: a.name ?? `Sheet${sheets.length + 1}`, target: rel.target });
		},
		close() {},
		text() {}
	});
	const counter = { cells: 0 };
	for (const sheet of sheets) {
		sink.add(`sheet:${sheet.name}`, sheet.name);
		const bytes = await pkg.read(sheet.target);
		if (bytes) sheetCells(bytes, sink, sheet.name, strings, counter);
		for (const c of typed(await rels(pkg, sink, sheet.target), 'comments')) {
			const comments = await pkg.read(c.target);
			if (comments) paragraphs(comments, sink, `${sheet.name}!comments`, DOCX_TEXT, new Set(['comment']), new Set(['rPh']));
		}
	}
}

const DRAWING_TEXT = new Set(['t']);
const DRAWING_PARA = new Set(['p']);
const NONE = new Set<string>();

async function pptx(pkg: Package, sink: Sink): Promise<void> {
	const main = await mainPart(pkg, sink, 'ppt/presentation.xml');
	const related = await rels(pkg, sink, main);
	const byId = new Map(related.map((r) => [r.id, r]));
	const presentation = await pkg.read(main);
	if (!presentation) throw new Stop('malformed');
	const slides: string[] = [];
	walkXml(presentation, sink, {
		open(name, a) {
			if (name !== 'sldId') return;
			const rel = byId.get(attr(a, 'id', true) ?? '');
			if (rel) slides.push(rel.target);
		},
		close() {},
		text() {}
	});
	for (let i = 0; i < slides.length; i++) {
		const bytes = await pkg.read(slides[i]);
		if (!bytes) continue;
		paragraphs(bytes, sink, `slide:${i + 1}`, DRAWING_TEXT, DRAWING_PARA, NONE);
		const slideRels = await rels(pkg, sink, slides[i]);
		for (const n of typed(slideRels, 'notesSlide')) {
			const notes = await pkg.read(n.target);
			if (notes) paragraphs(notes, sink, `notes:${i + 1}`, DRAWING_TEXT, DRAWING_PARA, new Set(['sldNum']));
		}
		for (const c of typed(slideRels, 'comments')) {
			const comments = await pkg.read(c.target);
			if (comments) paragraphs(comments, sink, `comments:${i + 1}`, new Set(['text']), new Set(['cm']), NONE);
		}
	}
}

export async function extractOoxml(pkg: Package, kind: OoxmlKind, sink: Sink): Promise<void> {
	if (kind === 'docx') return docx(pkg, sink);
	if (kind === 'xlsx') return xlsx(pkg, sink);
	return pptx(pkg, sink);
}
