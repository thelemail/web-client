import { listDrafts } from '$lib/api/drafts';
import { decryptPreview, DecryptionError } from '$lib/mail/decrypt';
import { initialsFor } from '$lib/mail/initials';
import type { DraftListItem } from '$lib/api/types';
import { auth } from './auth.svelte';

export interface DraftRow {
	id: string;
	subject: string;
	snippet: string;
	to: string;
	updatedAt: string;
	epoch: number;
	attachmentCount: number;
	init: string;
}

const PAGE_SIZE = 50;

function recipientSummary(displays: string[]): string {
	const cleaned = displays.map((d) => d.trim()).filter(Boolean);
	if (cleaned.length === 0) return '(no recipients)';
	if (cleaned.length <= 2) return cleaned.join(', ');
	return `${cleaned.slice(0, 2).join(', ')} +${cleaned.length - 2}`;
}

async function decryptRow(accountId: string, item: DraftListItem): Promise<DraftRow> {
	const preview = await decryptPreview(accountId, item.encryptedPreview);
	const updatedAt = new Date(item.updatedAt);
	const recipients = preview.recipients.map((r) => r.display || r.address);
	return {
		id: item.id,
		subject: preview.subject || '(no subject)',
		snippet: preview.snippet,
		to: recipientSummary(recipients),
		updatedAt: item.updatedAt,
		epoch: updatedAt.getTime(),
		attachmentCount: item.attachmentCount,
		init: initialsFor(preview.subject || '', '')
	};
}

function fallbackRow(item: DraftListItem): DraftRow {
	const updatedAt = new Date(item.updatedAt);
	return {
		id: item.id,
		subject: 'Could not decrypt draft',
		snippet: 'The preview could not be opened with this device’s key.',
		to: '',
		updatedAt: item.updatedAt,
		epoch: updatedAt.getTime(),
		attachmentCount: item.attachmentCount,
		init: '!'
	};
}

class DraftsStore {
	items = $state<DraftRow[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	exhausted = $state(false);
	loadError = $state<string | null>(null);

	#nextCursor: string | null = null;
	#accountId: string | null = null;
	#pending: Promise<void> | null = null;
	#loaded = false;
	#removed = new Set<string>();

	get count(): number {
		return this.items.length;
	}

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.items = [];
		this.#nextCursor = null;
		this.exhausted = false;
		this.loadError = null;
		this.#loaded = false;
		this.#removed.clear();
	}

	async ensureLoaded(): Promise<void> {
		if (this.#loaded) return;
		await this.#load(false);
	}

	async refresh(): Promise<void> {
		this.#nextCursor = null;
		this.exhausted = false;
		await this.#load(false, true);
	}

	async loadMore(): Promise<void> {
		if (this.exhausted || !this.#nextCursor) return;
		await this.#load(true);
	}

	remove(id: string): void {
		this.#removed.add(id);
		this.items = this.items.filter((i) => i.id !== id);
	}

	upsertLocal(row: DraftRow): void {
		this.#removed.delete(row.id);
		const rest = this.items.filter((i) => i.id !== row.id);
		this.items = [row, ...rest];
		this.#loaded = true;
	}

	async #load(more: boolean, force = false): Promise<void> {
		if (!auth.canEnterApp) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		if (this.#pending && !force) return this.#pending;

		if (more) this.loadingMore = true;
		else this.loading = true;
		this.loadError = null;

		const cursor = more ? (this.#nextCursor ?? undefined) : undefined;
		const run = (async () => {
			try {
				const resp = await listDrafts({ limit: PAGE_SIZE, cursor });
				if (this.#accountId !== accountId) return;
				const rows: DraftRow[] = [];
				for (const item of resp.items) {
					if (this.#removed.has(item.id)) continue;
					try {
						rows.push(await decryptRow(accountId, item));
					} catch (err) {
						if (!(err instanceof DecryptionError)) throw err;
						rows.push(fallbackRow(item));
					}
				}
				if (this.#accountId !== accountId) return;
				this.items = more ? this.#mergeRows(this.items, rows) : rows;
				this.#nextCursor = resp.nextCursor ?? null;
				this.exhausted = !resp.nextCursor;
				this.#loaded = true;
			} catch (err) {
				if (this.#accountId !== accountId) return;
				this.loadError = err instanceof Error ? err.message : 'Failed to load drafts.';
			} finally {
				if (more) this.loadingMore = false;
				else this.loading = false;
				this.#pending = null;
			}
		})();
		this.#pending = run;
		return run;
	}

	#mergeRows(target: DraftRow[], incoming: DraftRow[]): DraftRow[] {
		const seen = new Set(target.map((r) => r.id));
		const out = target.slice();
		for (const row of incoming) {
			if (!seen.has(row.id)) {
				out.push(row);
				seen.add(row.id);
			}
		}
		return out;
	}
}

export const drafts = new DraftsStore();
