import 'pdfjs-dist/build/pdf.worker.mjs';
import { getDocument } from 'pdfjs-dist';
import { Stop, type Sink } from './sink';

export type PdfAssets = ReadonlyMap<string, Uint8Array>;

let assets: PdfAssets = new Map();

export function setPdfAssets(next: PdfAssets): void {
	assets = next;
}

const DIRS: Record<string, string> = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts' };

class AssetData {
	constructor(_: unknown) {}

	async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
		const dir = DIRS[kind];
		const bytes = dir ? assets.get(`${dir}/${filename}`) : undefined;
		if (!bytes) throw new Error('asset');
		return bytes.slice();
	}
}

interface TextItem {
	str?: string;
	hasEOL?: boolean;
}

function pageText(items: readonly TextItem[]): string {
	let out = '';
	for (const item of items) {
		if (typeof item.str !== 'string') continue;
		out += item.str;
		if (item.hasEOL) out += '\n';
	}
	return out;
}

function stateOf(error: unknown): Stop {
	if (error instanceof Stop) return error;
	const name = (error as { name?: string } | null)?.name;
	if (name === 'PasswordException') return new Stop('password_required');
	return new Stop('malformed');
}

export async function extractPdf(bytes: Uint8Array, sink: Sink): Promise<void> {
	const task = getDocument({
		data: bytes,
		BinaryDataFactory: AssetData,
		useWorkerFetch: false,
		cMapUrl: 'cmaps/',
		cMapPacked: true,
		standardFontDataUrl: 'standard_fonts/',
		useWasm: false,
		useSystemFonts: false,
		disableFontFace: true,
		enableXfa: false,
		isOffscreenCanvasSupported: false,
		isImageDecoderSupported: false,
		disableAutoFetch: true,
		disableStream: true,
		disableRange: true,
		stopAtErrors: false,
		maxImageSize: 0,
		verbosity: 0
	} as Parameters<typeof getDocument>[0]);
	try {
		const doc = await task.promise;
		sink.tick();
		const pages = Math.min(doc.numPages, sink.limits.maxPages);
		for (let n = 1; n <= pages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent({ includeMarkedContent: false });
			page.cleanup();
			sink.add(`page:${n}`, pageText(content.items as TextItem[]));
			sink.tick();
		}
		if (doc.numPages > pages) throw new Stop('partial');
	} catch (error) {
		throw stateOf(error);
	} finally {
		await task.destroy().catch(() => undefined);
	}
}
