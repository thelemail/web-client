import { folderFromServer, type LabelId, type Message } from '$lib/mail/data';
import { initialsFor } from '$lib/mail/initials';
import { paletteFor } from '$lib/mail/avatarPalette';
import { searchIndex, type SearchResult } from '$lib/search';
import type { SearchHit } from '$lib/platform/types';
import { platform } from '$platform';

const DEBOUNCE_MS = 180;
const MIRROR_LIMIT = 200;

function messageFromResult(result: SearchResult): Message {
	const { row, text } = result;
	const display = text.senderDisplay || text.senderAddress || 'Unknown';
	const palette = paletteFor(text.senderAddress.toLowerCase());
	return {
		id: row.id,
		folder: folderFromServer(row.mailboxState, row.direction),
		direction: row.direction,
		from: display,
		fromAddr: text.senderAddress,
		to: text.recipients,
		recipients: [],
		init: initialsFor(display, text.senderAddress),
		bg: palette.bg,
		fg: palette.fg,
		epoch: row.storedAt,
		subj: text.subject || '(no subject)',
		labels: row.labels as LabelId[],
		unread: !row.read,
		starred: row.starred,
		snoozedUntil: row.snoozedUntil,
		prev: result.excerpt || text.snippet,
		body: [],
		threadRootId: row.threadRootId ?? undefined,
		attachments:
			row.attachmentCount > 0
				? new Array(row.attachmentCount).fill({ name: 'attachment', size: '' })
				: undefined
	};
}

function messageFromHit(hit: SearchHit): Message {
	const display = hit.senderDisplay || hit.senderAddress || 'Unknown';
	const palette = paletteFor(hit.senderAddress.toLowerCase());
	const storedAt = new Date(hit.storedAt).getTime();
	const state = hit.mailboxState as 'inbox' | 'archive' | 'trash' | 'spam' | 'snoozed';
	return {
		id: hit.id,
		folder: folderFromServer(state, 'received'),
		direction: 'received',
		from: display,
		fromAddr: hit.senderAddress,
		to: '',
		recipients: [],
		init: initialsFor(display, hit.senderAddress),
		bg: palette.bg,
		fg: palette.fg,
		epoch: Number.isNaN(storedAt) ? 0 : storedAt,
		subj: hit.subject || '(no subject)',
		labels: [],
		unread: !hit.read,
		starred: hit.starred,
		snoozedUntil: null,
		prev: hit.excerpt || hit.snippet,
		body: [],
		threadRootId: hit.threadRootId ?? undefined,
		attachments:
			hit.attachmentCount > 0
				? new Array(hit.attachmentCount).fill({ name: 'attachment', size: '' })
				: undefined
	};
}

class MailSearchStore {
	text = $state('');
	results = $state<Message[]>([]);
	searching = $state(false);
	indexed = $state(0);
	indexing = $state(false);
	complete = $state(false);

	#accountId: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#run = 0;
	#unsubscribe: (() => void) | null = null;

	get active(): boolean {
		return this.text.trim().length > 0;
	}

	get partial(): boolean {
		return this.active && !this.complete && !platform.mirror;
	}

	start(accountId: string): () => void {
		this.#accountId = accountId;
		this.#unsubscribe?.();
		if (platform.mirror) {
			return () => {
				this.#accountId = null;
			};
		}
		this.#unsubscribe = searchIndex.subscribe((progress) => {
			this.indexed = progress.indexed;
			this.complete = progress.complete;
			if (this.active) this.#execute();
		});
		void this.refresh();
		return () => {
			this.#unsubscribe?.();
			this.#unsubscribe = null;
			this.#accountId = null;
			searchIndex.close();
		};
	}

	async refresh(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId || platform.mirror) return;
		this.indexing = true;
		try {
			await searchIndex.sync(accountId);
		} catch {
			this.complete = false;
		} finally {
			if (this.#accountId === accountId) this.indexing = false;
		}
	}

	setText(next: string): void {
		this.text = next;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		if (!next.trim()) {
			this.#run += 1;
			this.results = [];
			this.searching = false;
			return;
		}
		this.searching = true;
		this.#timer = setTimeout(() => this.#execute(), DEBOUNCE_MS);
	}

	clear(): void {
		this.setText('');
	}

	#execute(): void {
		const accountId = this.#accountId;
		const query = this.text.trim();
		if (!accountId || !query) {
			this.results = [];
			this.searching = false;
			return;
		}
		const run = ++this.#run;
		const mirror = platform.mirror;
		if (mirror) {
			void mirror
				.search(accountId, query, MIRROR_LIMIT)
				.then((hits) => {
					if (run !== this.#run) return;
					this.results = hits.map(messageFromHit);
					this.searching = false;
				})
				.catch(() => {
					if (run !== this.#run) return;
					this.results = [];
					this.searching = false;
				});
			return;
		}
		this.results = searchIndex.search(query).map(messageFromResult);
		this.searching = false;
	}
}

export const mailSearch = new MailSearchStore();
