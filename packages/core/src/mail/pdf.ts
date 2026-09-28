import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfFailure = 'password' | 'failed';

export class PdfOpenError extends Error {
	reason: PdfFailure;
	constructor(reason: PdfFailure) {
		super(reason);
		this.reason = reason;
		this.name = 'PdfOpenError';
	}
}

type Pdfjs = typeof import('pdfjs-dist');

let ready: Promise<Pdfjs> | null = null;

function pdfjs(): Promise<Pdfjs> {
	ready ??= (async () => {
		const [lib, { default: PdfWorker }] = await Promise.all([
			import('pdfjs-dist'),
			import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
		]);
		lib.GlobalWorkerOptions.workerPort = new PdfWorker();
		return lib;
	})().catch((err) => {
		ready = null;
		throw err;
	});
	return ready;
}

function assetBase(dir: string): string {
	return new URL(`/pdfjs/${dir}/`, location.href).href;
}

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
	const lib = await pdfjs();
	const data = new Uint8Array(await blob.arrayBuffer());
	const task = lib.getDocument({
		data,
		wasmUrl: assetBase('wasm'),
		cMapUrl: assetBase('cmaps'),
		standardFontDataUrl: assetBase('standard_fonts'),
		iccUrl: assetBase('iccs'),
		enableXfa: false,
		disableAutoFetch: true,
		disableStream: true
	});
	try {
		return await task.promise;
	} catch (err) {
		await task.destroy().catch(() => undefined);
		throw new PdfOpenError(err instanceof lib.PasswordException ? 'password' : 'failed');
	}
}

export function isRenderCancelled(err: unknown): boolean {
	return err instanceof Error && err.name === 'RenderingCancelledException';
}
