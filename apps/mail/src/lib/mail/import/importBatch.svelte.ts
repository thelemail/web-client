import { SendError } from '../send';
import { ApiCallError } from '$lib/api/types';
import { importEmlFile } from './buildImport';
import {
	clearTerminalImportFiles,
	getImportFile,
	listImportFiles,
	markTerminal,
	putImportFile,
	type ImportFileRecord,
	type ImportFileStatus
} from './importStore';

export type ImportItemStatus = 'pending' | 'processing' | 'done' | 'duplicate' | 'failed';

export interface ImportItem {
	id: string;
	name: string;
	size: number;
	status: ImportItemStatus;
	error?: string;
}

const FILE_CONCURRENCY = 3;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	let s = '';
	for (const b of digest) s += b.toString(16).padStart(2, '0');
	return s;
}

function toItem(rec: ImportFileRecord): ImportItem {
	return { id: rec.id, name: rec.name, size: rec.size, status: rec.status, error: rec.error };
}

class ImportController {
	items = $state<ImportItem[]>([]);
	running = $state(false);
	locked = $state(false);
	#accountId: string | null = null;
	#aborted = false;

	get pending(): number {
		return this.items.filter((i) => i.status === 'pending' || i.status === 'processing').length;
	}
	get done(): number {
		return this.items.filter((i) => i.status === 'done').length;
	}
	get duplicate(): number {
		return this.items.filter((i) => i.status === 'duplicate').length;
	}
	get failed(): number {
		return this.items.filter((i) => i.status === 'failed').length;
	}
	get resumable(): number {
		return this.items.filter((i) => i.status === 'pending').length;
	}

	async load(accountId: string): Promise<void> {
		this.#accountId = accountId;
		const records = await listImportFiles(accountId);
		records.sort((a, b) => a.updatedAt - b.updatedAt);
		this.items = records.map(toItem);
	}

	async addFiles(files: File[]): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		for (const file of files) {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const hash = await sha256Hex(bytes);
			const id = `${accountId}:${hash}`;
			const existing = this.items.find((i) => i.id === id);
			if (existing && existing.status !== 'failed') continue;
			const rec: ImportFileRecord = {
				id,
				accountId,
				name: file.name,
				size: file.size,
				contentHash: hash,
				bytes,
				status: 'pending',
				updatedAt: Date.now()
			};
			await putImportFile(rec);
			if (existing) {
				this.#patch(id, { status: 'pending', error: undefined });
			} else {
				this.items = [...this.items, toItem(rec)];
			}
		}
	}

	#patch(id: string, patch: Partial<ImportItem>): void {
		this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
	}

	async run(onComplete?: () => void): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId || this.running) return;
		this.running = true;
		this.locked = false;
		this.#aborted = false;

		const queue = this.items.filter((i) => i.status === 'pending').map((i) => i.id);
		let cursor = 0;
		const worker = async () => {
			while (cursor < queue.length && !this.#aborted) {
				const id = queue[cursor++];
				await this.#process(accountId, id);
			}
		};
		const workers = Array.from({ length: Math.min(FILE_CONCURRENCY, queue.length) }, () => worker());
		await Promise.all(workers);

		this.running = false;
		if (!this.#aborted) onComplete?.();
	}

	async #process(accountId: string, id: string): Promise<void> {
		const rec = await getImportFile(id);
		if (!rec || !rec.bytes) {
			await markTerminal(id, 'failed', { error: 'file data unavailable' });
			this.#patch(id, { status: 'failed', error: 'file data unavailable' });
			return;
		}
		this.#patch(id, { status: 'processing', error: undefined });
		try {
			const res = await importEmlFile(accountId, rec.bytes);
			const status: ImportFileStatus = res.existing ? 'duplicate' : 'done';
			await markTerminal(id, status, { messageId: res.messageId });
			this.#patch(id, { status, error: undefined });
		} catch (err) {
			if (err instanceof SendError && err.code === 'locked') {
				this.#aborted = true;
				this.locked = true;
				this.#patch(id, { status: 'pending' });
				return;
			}
			const message = errorMessage(err);
			await markTerminal(id, 'failed', { error: message });
			this.#patch(id, { status: 'failed', error: message });
		}
	}

	async clearCompleted(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		await clearTerminalImportFiles(accountId);
		this.items = this.items.filter((i) => i.status === 'pending' || i.status === 'processing');
	}
}

function errorMessage(err: unknown): string {
	if (err instanceof ApiCallError) {
		if (err.status === 402) return 'subscription required';
		if (err.status === 507 || err.status === 413) return 'storage quota exceeded';
	}
	if (err instanceof Error) return err.message;
	return String(err);
}

export const importBatch = new ImportController();
