import { extractOdf, odfKindOf } from './odf';
import { extractOoxml, ooxmlKindOf } from './ooxml';
import { extractPdf } from './pdf';
import { FILE_LIMITS, Sink, Stop, type FileLimits, type FileText, type Tick } from './sink';
import { extractHtml, extractPlain } from './text';
import { Package, isZip } from './zip';

export { FILE_LIMITS, FileWarning, type FileLimits, type FilePart, type FileState, type FileText } from './sink';
export { setPdfAssets, type PdfAssets } from './pdf';

export interface FileInput {
	bytes: Uint8Array;
	filename: string;
	mime: string;
}

const TEXT_EXT = new Set([
	'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'tab', 'json', 'jsonl', 'ndjson', 'xml', 'log', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'eml',
	'ics', 'vcf', 'rtf', 'tex', 'srt', 'vtt', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
	'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'pl', 'lua', 'r', 'scala', 'dart', 'css', 'scss', 'less', 'svelte', 'vue', 'diff', 'patch'
]);
const HTML_EXT = new Set(['html', 'htm', 'xhtml']);
const OOXML_EXT = new Set(['docx', 'docm', 'dotx', 'dotm', 'xlsx', 'xlsm', 'xltx', 'xltm', 'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm']);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TEXT_MIME = /^(text\/(plain|markdown|x-markdown|csv|tab-separated-values|xml|calendar|vcard|x-[a-z0-9.+-]+)|application\/(json|xml|ld\+json|x-ndjson|[a-z0-9.-]+\+(json|xml)))$/;

function extOf(filename: string): string {
	const i = filename.lastIndexOf('.');
	return i < 0 ? '' : filename.slice(i + 1).toLowerCase();
}

function charsetOf(mime: string): string | null {
	return /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(mime)?.[1] ?? null;
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
	return magic.every((b, i) => bytes[i] === b);
}

function isPdf(bytes: Uint8Array): boolean {
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
	return head.includes('%PDF-');
}

async function extractPackage(bytes: Uint8Array, sink: Sink): Promise<void> {
	const { pkg, close } = await Package.open(bytes, sink);
	try {
		const ooxml = ooxmlKindOf(pkg);
		if (ooxml) return await extractOoxml(pkg, ooxml, sink);
		const odf = await odfKindOf(pkg);
		if (odf) return await extractOdf(pkg, odf, sink);
		throw new Stop('unsupported');
	} finally {
		await close();
	}
}

async function dispatch(input: FileInput, sink: Sink): Promise<void> {
	const { bytes, filename } = input;
	const mime = input.mime.toLowerCase();
	const type = mime.split(';')[0].trim();
	const ext = extOf(filename);
	if (bytes.length > sink.limits.maxInput) throw new Stop('partial');
	if (isPdf(bytes)) return extractPdf(bytes, sink);
	if (isZip(bytes)) return extractPackage(bytes, sink);
	if (startsWith(bytes, OLE)) throw new Stop(OOXML_EXT.has(ext) ? 'password_required' : 'unsupported');
	if (type === 'text/html' || type === 'application/xhtml+xml' || HTML_EXT.has(ext)) return extractHtml(bytes, charsetOf(mime), sink);
	if (TEXT_MIME.test(type) || TEXT_EXT.has(ext)) return extractPlain(bytes, charsetOf(mime), sink);
	throw new Stop('unsupported');
}

export async function extractFile(input: FileInput, tick: Tick, limits: FileLimits = FILE_LIMITS): Promise<FileText> {
	const sink = new Sink(limits, tick);
	try {
		await dispatch(input, sink);
		return sink.result();
	} catch (error) {
		return sink.result(error instanceof Stop ? error.state : 'malformed');
	}
}
