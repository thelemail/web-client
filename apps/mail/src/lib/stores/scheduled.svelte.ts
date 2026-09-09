import { cancelScheduledSend, listScheduledSends } from '$lib/api/scheduledSends';
import { decryptPreview, DecryptionError } from '$lib/mail/decrypt';
import { initialsFor } from '$lib/mail/initials';
import type { ScheduledSend, ScheduledSendKind } from '$lib/api/types';
import { auth } from './auth.svelte';

export interface ScheduledRow {
	id: string;
	kind: ScheduledSendKind;
	subject: string;
	snippet: string;
	to: string;
	scheduledAt: string;
	epoch: number;
	init: string;
	decrypted: boolean;
}

const PAGE_SIZE = 50;

function recipientSummary(displays: string[]): string {
	const cleaned = displays.map((d) => d.trim()).filter(Boolean);
	if (cleaned.length === 0) return '(no recipients)';
	if (cleaned.length <= 2) return cleaned.join(', ');
	return `${cleaned.slice(0, 2).join(', ')} +${cleaned.length - 2}`;
}

async function decryptRow(accountId: string, item: ScheduledSend): Promise<ScheduledRow> {
	const preview = await decryptPreview(accountId, item.encryptedPreview);
	const recipients = preview.recipients.map((r) => r.display || r.address);
	return {
		id: item.id,
		kind: item.kind,
		subject: preview.subject || '(no subject)',
		snippet: preview.snippet,
		to: recipientSummary(recipients),
		scheduledAt: item.scheduledAt,
		epoch: new Date(item.scheduledAt).getTime(),
		init: initialsFor(preview.subject || '', ''),
		decrypted: true
	};
}

function fallbackRow(item: ScheduledSend): ScheduledRow {
	return {
		id: item.id,
		kind: item.kind,
		subject: 'Could not decrypt message',
		snippet: 'The preview could not be opened with this device’s key.',
		to: '',
		scheduledAt: item.scheduledAt,
		epoch: new Date(item.scheduledAt).getTime(),
		init: '!',
		decrypted: false
	};
}

class ScheduledStore {
	items = $state<ScheduledRow[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	exhausted = $state(false);
	loadError = $state<string | null>(null);

	#nextCursor: string | null = null;
	#accountId: string | null = null;
	#pending: Promise<void> | null = null;
	#loaded = false;

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

	async cancel(id: string): Promise<void> {
		const before = this.items;
		this.items = this.items.filter((r) => r.id !== id);
		try {
			await cancelScheduledSend(id);
		} catch (err) {
			this.items = before;
			throw err;
		}
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
				const resp = await listScheduledSends({ limit: PAGE_SIZE, cursor });
				if (this.#accountId !== accountId) return;
				const rows: ScheduledRow[] = [];
				for (const item of resp.items) {
					try {
						rows.push(await decryptRow(accountId, item));
					} catch (err) {
						if (!(err instanceof DecryptionError)) throw err;
						rows.push(fallbackRow(item));
					}
				}
				if (this.#accountId !== accountId) return;
				const merged = more ? this.#mergeRows(this.items, rows) : rows;
				this.items = merged.slice().sort((a, b) => a.epoch - b.epoch);
				this.#nextCursor = resp.nextCursor ?? null;
				this.exhausted = !resp.nextCursor;
				this.#loaded = true;
			} catch (err) {
				if (this.#accountId !== accountId) return;
				this.loadError = err instanceof Error ? err.message : 'Failed to load scheduled sends.';
			} finally {
				if (more) this.loadingMore = false;
				else this.loading = false;
				this.#pending = null;
			}
		})();
		this.#pending = run;
		return run;
	}

	#mergeRows(target: ScheduledRow[], incoming: ScheduledRow[]): ScheduledRow[] {
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

export const scheduled = new ScheduledStore();
