import { Uint8ArrayReader, ZipReader, configure, type FileEntry } from '@zip.js/zip.js/lib/zip-core-native.js';
import { Stop, type Sink } from './sink';

configure({ useWebWorkers: false, useCompressionStream: true });

const RATIO_FLOOR = 64 * 1024;

function normalized(name: string): string | null {
	if (!name || name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name) || name.includes('\0')) return null;
	const segments = name.split('/');
	if (segments.some((s, i) => s === '..' || s === '.' || (s === '' && i < segments.length - 1))) return null;
	return name.toLowerCase();
}

export function isZip(bytes: Uint8Array): boolean {
	return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

export class Package {
	#entries: Map<string, FileEntry>;
	#sink: Sink;
	#expanded = 0;

	private constructor(entries: Map<string, FileEntry>, sink: Sink) {
		this.#entries = entries;
		this.#sink = sink;
	}

	static async open(bytes: Uint8Array, sink: Sink): Promise<{ pkg: Package; close: () => Promise<void> }> {
		const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
		const entries = new Map<string, FileEntry>();
		try {
			let count = 0;
			for await (const entry of reader.getEntriesGenerator()) {
				if (++count > sink.limits.maxEntries) throw new Stop('partial');
				if (count % 256 === 0) sink.tick();
				const key = normalized(entry.filename);
				if (key === null) throw new Stop('malformed');
				if (entry.directory) continue;
				if (entries.has(key)) throw new Stop('malformed');
				entries.set(key, entry as FileEntry);
			}
		} catch (error) {
			await reader.close().catch(() => undefined);
			if (error instanceof Stop) throw error;
			throw new Stop('malformed');
		}
		return { pkg: new Package(entries, sink), close: () => reader.close().then(() => undefined, () => undefined) };
	}

	has(path: string): boolean {
		return this.#entries.has(path.toLowerCase());
	}

	names(): string[] {
		return [...this.#entries.keys()];
	}

	async read(path: string): Promise<Uint8Array | null> {
		const entry = this.#entries.get(path.toLowerCase());
		if (!entry) return null;
		if (entry.encrypted) throw new Stop('password_required');
		const { maxExpanded, maxRatio } = this.#sink.limits;
		const remaining = maxExpanded - this.#expanded;
		const ratioCap = Math.max(entry.compressedSize * maxRatio, RATIO_FLOOR);
		if (entry.uncompressedSize > remaining || entry.uncompressedSize > ratioCap) throw new Stop('partial');
		const limit = Math.min(remaining, ratioCap);
		const chunks: Uint8Array[] = [];
		let size = 0;
		let over = false;
		const sink = new WritableStream<Uint8Array>({
			write: (chunk) => {
				size += chunk.length;
				if (size > limit) {
					over = true;
					throw new Stop('partial');
				}
				chunks.push(chunk);
				this.#sink.tick();
			}
		});
		try {
			await entry.getData(sink, { useWebWorkers: false });
		} catch {
			if (over) throw new Stop('partial');
			throw new Stop('malformed');
		}
		if (over) throw new Stop('partial');
		this.#expanded += size;
		const out = new Uint8Array(size);
		let offset = 0;
		for (const c of chunks) {
			out.set(c, offset);
			offset += c.length;
		}
		return out;
	}
}
