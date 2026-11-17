import { RowChunks, cellName } from './ooxml';
import { Chunker, Stop, type Sink } from './sink';
import { attr, walkXml } from './xml';
import type { Package } from './zip';

export type OdfKind = 'odt' | 'ods' | 'odp';

const MIMETYPES: Record<string, OdfKind> = {
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/vnd.oasis.opendocument.text-template': 'odt',
	'application/vnd.oasis.opendocument.spreadsheet': 'ods',
	'application/vnd.oasis.opendocument.spreadsheet-template': 'ods',
	'application/vnd.oasis.opendocument.presentation': 'odp',
	'application/vnd.oasis.opendocument.presentation-template': 'odp'
};

const PARAGRAPH = new Set(['p', 'h']);
const MAX_REPEAT = 1024;

export async function odfKindOf(pkg: Package): Promise<OdfKind | null> {
	const bytes = pkg.has('mimetype') ? await pkg.read('mimetype') : null;
	if (!bytes) return null;
	return MIMETYPES[new TextDecoder().decode(bytes).trim()] ?? null;
}

async function encrypted(pkg: Package, sink: Sink): Promise<boolean> {
	const manifest = await pkg.read('META-INF/manifest.xml');
	if (!manifest) return false;
	let found = false;
	walkXml(manifest, sink, {
		open(name) {
			if (name === 'encryption-data') found = true;
		},
		close() {},
		text() {}
	});
	return found;
}

class Text {
	line = '';
	depth = 0;

	open(name: string, a: Readonly<Record<string, string>>): void {
		if (PARAGRAPH.has(name)) this.depth++;
		else if (this.depth > 0 && name === 's') this.line += ' '.repeat(Math.min(Number(attr(a, 'c', true)) || 1, 64));
		else if (this.depth > 0 && name === 'tab') this.line += '\t';
		else if (this.depth > 0 && name === 'line-break') this.line += '\n';
	}

	close(name: string): boolean {
		if (!PARAGRAPH.has(name)) return false;
		this.depth--;
		if (this.depth > 0) return false;
		this.line += '\n';
		return true;
	}

	text(t: string): void {
		if (this.depth > 0) this.line += t;
	}

	take(): string {
		const out = this.line;
		this.line = '';
		return out;
	}
}

function writer(bytes: Uint8Array, sink: Sink): void {
	const chunks = new Chunker(sink, 'body');
	const text = new Text();
	let skip = 0;
	walkXml(bytes, sink, {
		open(name, a) {
			if (name === 'tracked-changes') skip++;
			if (!skip) text.open(name, a);
		},
		close(name) {
			if (name === 'tracked-changes') skip--;
			else if (!skip && text.close(name)) chunks.line(text.take());
		},
		text(t) {
			if (!skip) text.text(t);
		}
	});
	chunks.flush();
}

function spreadsheet(bytes: Uint8Array, sink: Sink): void {
	const text = new Text();
	let rows: RowChunks | null = null;
	let sheet = '';
	let row = 0;
	let rowRepeat = 1;
	let col = 0;
	let cells: { ref: string; text: string }[] = [];
	let cell: { ref: string; repeat: number } | null = null;
	let visited = 0;
	walkXml(bytes, sink, {
		open(name, a) {
			if (name === 'table') {
				sheet = attr(a, 'name', true) ?? `Sheet${row}`;
				sink.add(`sheet:${sheet}`, sheet);
				rows = new RowChunks(sink, sheet);
				row = 0;
			} else if (name === 'table-row') {
				rowRepeat = Math.max(1, Number(attr(a, 'number-rows-repeated', true)) || 1);
				row++;
				col = 0;
				cells = [];
			} else if (name === 'table-cell' || name === 'covered-table-cell') {
				const repeat = Math.max(1, Number(attr(a, 'number-columns-repeated', true)) || 1);
				col++;
				cell = { ref: cellName(col, row), repeat };
				text.take();
			} else if (cell) text.open(name, a);
		},
		close(name) {
			if ((name === 'table-cell' || name === 'covered-table-cell') && cell) {
				const value = text.take().trim();
				if (value) {
					const copies = Math.min(cell.repeat, MAX_REPEAT);
					visited += copies;
					if (visited > sink.limits.maxCells) throw new Stop('partial');
					for (let i = 0; i < copies; i++) cells.push({ ref: cellName(col + i, row), text: value });
				}
				col += cell.repeat - 1;
				cell = null;
			} else if (name === 'table-row') {
				if (cells.length) rows?.row(cells);
				row += rowRepeat - 1;
			} else if (name === 'table') {
				rows?.flush();
				rows = null;
			} else if (cell) text.close(name);
		},
		text(t) {
			if (cell) text.text(t);
		}
	});
}

function presentation(bytes: Uint8Array, sink: Sink): void {
	const text = new Text();
	let page = 0;
	let notes = 0;
	let chunks: Chunker | null = null;
	let notesChunks: Chunker | null = null;
	walkXml(bytes, sink, {
		open(name, a) {
			if (name === 'page') {
				page++;
				chunks = new Chunker(sink, `slide:${page}`);
				notesChunks = new Chunker(sink, `notes:${page}`);
			} else if (name === 'notes') notes++;
			else text.open(name, a);
		},
		close(name) {
			if (name === 'page') {
				chunks?.flush();
				notesChunks?.flush();
				chunks = null;
				notesChunks = null;
			} else if (name === 'notes') notes--;
			else if (text.close(name)) (notes > 0 ? notesChunks : chunks)?.line(text.take());
		},
		text(t) {
			text.text(t);
		}
	});
}

export async function extractOdf(pkg: Package, kind: OdfKind, sink: Sink): Promise<void> {
	if (await encrypted(pkg, sink)) throw new Stop('password_required');
	const content = await pkg.read('content.xml');
	if (!content) throw new Stop('malformed');
	if (kind === 'odt') writer(content, sink);
	else if (kind === 'ods') spreadsheet(content, sink);
	else presentation(content, sink);
}
