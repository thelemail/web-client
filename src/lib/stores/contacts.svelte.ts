import { browser } from '$app/environment';
import { listMessages } from '$lib/api/messages';
import { decryptPreview } from '$lib/mail/decrypt';
import { initialsFor } from '$lib/mail/initials';
import type { Contact } from '$lib/mail/data';
import type { MessageListItem } from '$lib/api/types';
import { auth } from './auth.svelte';
import { addresses } from './addresses.svelte';

const PAGE_SIZE = 100;

const PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
	{ bg: 'var(--brass-100)', fg: 'var(--brass-700)' },
	{ bg: 'var(--pine-100)', fg: 'var(--pine-700)' },
	{ bg: 'var(--info-100)', fg: 'var(--info-700)' },
	{ bg: '#ECE3FF', fg: '#6D28D9' },
	{ bg: 'var(--paper-200)', fg: 'var(--ink-700)' }
];

function paletteFor(seed: string): { bg: string; fg: string } {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

interface Correspondent {
	name: string;
	email: string;
	count: number;
	lastEpoch: number;
}

class ContactsStore {
	items = $state<Contact[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	#accountId: string | null = null;
	#loaded = false;
	#pending: Promise<void> | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.items = [];
		this.error = null;
		this.#loaded = false;
		this.#pending = null;
	}

	async ensureLoaded(): Promise<void> {
		if (this.#loaded) return;
		if (this.#pending) return this.#pending;
		this.#pending = this.#load();
		try {
			await this.#pending;
		} finally {
			this.#pending = null;
		}
	}

	async #load(): Promise<void> {
		if (!browser) return;
		const accountId = this.#accountId;
		if (!accountId) return;

		this.loading = true;
		this.error = null;
		try {
			const [received, sent] = await Promise.all([
				listMessages({ direction: 'received', limit: PAGE_SIZE }),
				listMessages({ direction: 'sent', limit: PAGE_SIZE })
			]);
			if (this.#accountId !== accountId) return;

			const own = new Set<string>();
			if (auth.email) own.add(auth.email.toLowerCase());
			for (const a of addresses.items) own.add(a.email.toLowerCase());

			const byEmail = new Map<string, Correspondent>();
			const add = (display: string, address: string, epoch: number) => {
				const email = address.trim();
				if (!email) return;
				const key = email.toLowerCase();
				if (own.has(key)) return;
				const name = display.trim();
				const existing = byEmail.get(key);
				if (existing) {
					existing.count += 1;
					if (!existing.name && name) existing.name = name;
					if (epoch > existing.lastEpoch) existing.lastEpoch = epoch;
				} else {
					byEmail.set(key, { name, email, count: 1, lastEpoch: epoch });
				}
			};

			await this.#collect(accountId, received.items, (preview, epoch) =>
				add(preview.sender.display, preview.sender.address, epoch)
			);
			await this.#collect(accountId, sent.items, (preview, epoch) => {
				for (const r of preview.recipients) add(r.display, r.address, epoch);
			});
			if (this.#accountId !== accountId) return;

			this.items = [...byEmail.values()]
				.sort((a, b) => b.count - a.count || b.lastEpoch - a.lastEpoch)
				.map((c) => {
					const name = c.name || c.email;
					const pal = paletteFor(c.email.toLowerCase());
					return {
						name,
						email: c.email,
						init: initialsFor(c.name || null, c.email),
						bg: pal.bg,
						fg: pal.fg
					};
				});
			this.#loaded = true;
		} catch (err) {
			if (this.#accountId !== accountId) return;
			this.error = err instanceof Error ? err.message : 'failed to load contacts';
		} finally {
			if (this.#accountId === accountId) this.loading = false;
		}
	}

	async #collect(
		accountId: string,
		items: MessageListItem[],
		fn: (preview: Awaited<ReturnType<typeof decryptPreview>>, epoch: number) => void
	): Promise<void> {
		for (const item of items) {
			try {
				const preview = await decryptPreview(accountId, item.encryptedPreview);
				fn(preview, new Date(item.storedAt).getTime());
			} catch {
			}
		}
	}
}

export const contacts = new ContactsStore();
