import { extract, parseMime, type Extracted } from './extract';
import { extractFile, type FileText, type Tick } from './files/index';

export type ParseRequest =
	| { kind: 'mime'; bytes: Uint8Array }
	| { kind: 'draft'; bytes: Uint8Array }
	| { kind: 'file'; bytes: Uint8Array; filename: string; mime: string }
	| { kind: 'part'; bytes: Uint8Array; index: number; filename: string; mime: string };

export type ParseResult = { kind: 'message'; value: Extracted } | { kind: 'file'; value: FileText };

const MALFORMED: FileText = { state: 'malformed', parts: [], warnings: 0 };

function bytesOf(content: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof content === 'string') return new TextEncoder().encode(content);
	return content instanceof Uint8Array ? content : new Uint8Array(content);
}

async function part(request: Extract<ParseRequest, { kind: 'part' }>, tick: Tick): Promise<FileText> {
	let content: ArrayBuffer | Uint8Array | string | undefined;
	try {
		content = (await parseMime(request.bytes)).attachments[request.index]?.content;
	} catch {
		return MALFORMED;
	}
	if (content === undefined) return MALFORMED;
	tick();
	return extractFile({ bytes: bytesOf(content), filename: request.filename, mime: request.mime }, tick);
}

export async function parse(request: ParseRequest, tick: Tick): Promise<ParseResult> {
	switch (request.kind) {
		case 'mime':
		case 'draft':
			return { kind: 'message', value: await extract(request) };
		case 'file':
			return { kind: 'file', value: await extractFile(request, tick) };
		case 'part':
			return { kind: 'file', value: await part(request, tick) };
	}
}
