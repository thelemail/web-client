import { htmlToText } from '../html';
import { Chunker, FileWarning, Stop, type Sink } from './sink';

const XML_DECL = /^<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/;
const SLICE = 256 * 1024;

function bomOf(bytes: Uint8Array): { label: string; skip: number } | null {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { label: 'utf-8', skip: 3 };
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return { label: 'utf-16le', skip: 2 };
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return { label: 'utf-16be', skip: 2 };
	return null;
}

function decoder(label: string, fatal: boolean): TextDecoder | null {
	try {
		return new TextDecoder(label, { fatal });
	} catch {
		return null;
	}
}

function looksBinary(bytes: Uint8Array): boolean {
	const head = bytes.subarray(0, 8192);
	let control = 0;
	for (const b of head) {
		if (b === 0) return true;
		if (b < 9 || (b > 13 && b < 32)) control++;
	}
	return head.length > 0 && control / head.length > 0.1;
}

export function decodeText(bytes: Uint8Array, declared: string | null, sink: Sink): string {
	const bom = bomOf(bytes);
	if (bom) return new TextDecoder(bom.label).decode(bytes.subarray(bom.skip));
	if (looksBinary(bytes)) throw new Stop('unsupported');
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 256));
	const label = declared ?? XML_DECL.exec(head)?.[1] ?? null;
	if (label) {
		const d = decoder(label, false);
		if (d) return d.decode(bytes);
		sink.warnings |= FileWarning.charset;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		sink.warnings |= FileWarning.charset;
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

export function emitLines(sink: Sink, text: string, place: (from: number, to: number) => string): void {
	const lines = text.split(/\r\n|\r|\n/);
	let start = 0;
	let buffer: string[] = [];
	let length = 0;
	const flush = (end: number) => {
		if (buffer.length) sink.add(place(start + 1, end), buffer.join('\n'));
		buffer = [];
		length = 0;
	};
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (length > 0 && length + line.length > sink.limits.maxPart) {
			flush(i);
			start = i;
		}
		if (buffer.length === 0) start = i;
		while (line.length > SLICE) {
			sink.add(place(i + 1, i + 1), line.slice(0, SLICE));
			line = line.slice(SLICE);
			sink.tick();
		}
		buffer.push(line);
		length += line.length + 1;
		if (i % 4096 === 0) sink.tick();
	}
	flush(lines.length);
}

export function extractPlain(bytes: Uint8Array, charset: string | null, sink: Sink): void {
	const text = decodeText(bytes, charset, sink);
	emitLines(sink, text, (from, to) => (from === to ? `line:${from}` : `lines:${from}-${to}`));
}

export function extractHtml(bytes: Uint8Array, charset: string | null, sink: Sink): void {
	const chunks = new Chunker(sink, 'html');
	for (const paragraph of htmlToText(decodeText(bytes, charset, sink)).split(/\n+/)) chunks.line(paragraph);
	chunks.flush();
}
