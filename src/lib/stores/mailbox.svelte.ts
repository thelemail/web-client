import {
	getMailboxCounts,
	getMessage,
	listMessages,
	listThreads,
	type ListMessagesOptions,
	type ListThreadsOptions
} from '$lib/api/messages';
import {
	folderFromServer,
	type LabelId,
	type Message,
	type RouteFolder
} from '$lib/mail/data';
import { decryptPreview, DecryptionError } from '$lib/mail/decrypt';
import { bimiDomainFromPreview } from '$lib/mail/preview';
import { initialsFor } from '$lib/mail/initials';
import type { MailboxCounts, MessageListItem, ThreadListItem } from '$lib/api/types';
import { DEFAULT_QUERY, type Query } from '$lib/mail/url';
import { auth } from './auth.svelte';
import { decodeWords } from 'postal-mime';

interface Stream {
	query: Query;
	items: Message[];
	nextCursor: string | null;
	exhausted: boolean;
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
}

export interface StreamSnapshot {
	msgs: Message[];
	loading: boolean;
	loadingMore: boolean;
	exhausted: boolean;
	loadError: string | null;
}

const PAGE_SIZE = 50;

const EMPTY_SNAPSHOT: StreamSnapshot = Object.freeze({
	msgs: [],
	loading: false,
	loadingMore: false,
	exhausted: false,
	loadError: null
});

function emptyStream(query: Query): Stream {
	return {
		query,
		items: [],
		nextCursor: null,
		exhausted: false,
		loading: false,
		loadingMore: false,
		error: null
	};
}

function streamKey(q: Query): string {
	const labels = q.labels.slice().sort().join(',');
	return [
		q.folder,
		q.sort,
		q.unread ? '1' : '0',
		q.attach ? '1' : '0',
		`L:${labels}`
	].join('|');
}

function listOptionsFor(q: Query): ListMessagesOptions | null {
	const base: ListMessagesOptions = { limit: PAGE_SIZE, sort: q.sort };
	switch (q.folder) {
		case 'inbox':
			Object.assign(base, { direction: 'received' as const, mailbox: 'inbox' as const });
			break;
		case 'sent':
			Object.assign(base, { direction: 'sent' as const, mailbox: 'inbox' as const });
			break;
		case 'archive':
			Object.assign(base, { mailbox: 'archive' as const });
			break;
		case 'trash':
			Object.assign(base, { mailbox: 'trash' as const });
			break;
		case 'starred':
			Object.assign(base, { starred: true });
			break;
		case 'spam':
			Object.assign(base, { mailbox: 'spam' as const });
			break;
		case 'snoozed':
			Object.assign(base, { mailbox: 'snoozed' as const });
			break;
		case 'drafts':
		case 'scheduled':
			return null;
	}
	if (q.unread) base.unread = true;
	if (q.attach) base.hasAttachments = true;
	if (q.labels.length) base.labels = q.labels.slice();
	return base;
}

function threadOptionsFor(q: Query): ListThreadsOptions | null {
	if (q.folder === 'drafts' || q.folder === 'scheduled' || q.folder === 'sent') return null;
	const base: ListThreadsOptions = { limit: PAGE_SIZE, sort: q.sort };
	switch (q.folder) {
		case 'inbox':
			base.mailbox = 'inbox';
			break;
		case 'archive':
			base.mailbox = 'archive';
			break;
		case 'trash':
			base.mailbox = 'trash';
			break;
		case 'spam':
			base.mailbox = 'spam';
			break;
		case 'snoozed':
			base.mailbox = 'snoozed';
			break;
		case 'starred':
			base.starred = true;
			break;
	}
	if (q.unread) base.unread = true;
	if (q.attach) base.hasAttachments = true;
	if (q.labels.length) base.labels = q.labels.slice();
	return base;
}

export function canFetchFolder(folder: RouteFolder): boolean {
	return listOptionsFor({ ...DEFAULT_QUERY, folder }) !== null;
}

function withThreadAggregates(m: Message, t: ThreadListItem): Message {
	return {
		...m,
		unread: t.unreadCount > 0 || !t.latest.read,
		starred: m.starred || t.starred,
		threadCount: t.messageCount > 1 ? t.messageCount : undefined,
		threadRootId: t.threadKey,
		attachments:
			m.attachments ?? (t.hasAttachments ? [{ name: 'attachment', size: '' }] : undefined)
	};
}

async function decryptItem(accountId: string, item: MessageListItem): Promise<Message> {
	const preview = await decryptPreview(accountId, item.encryptedPreview);
	const storedAt = new Date(item.storedAt);
	const fromDisplay = preview.sender.display || preview.sender.address || 'Unknown';
	const init = initialsFor(fromDisplay, preview.sender.address);
	const toAddresses = preview.recipients.filter((r) => r.kind === 'to').map((r) => r.address);
	const labels = (item.labels ?? []) as LabelId[];
	return {
		id: item.id,
		folder: folderFromServer(item.mailboxState, item.direction),
		direction: item.direction,
		from: fromDisplay,
		fromAddr: preview.sender.address,
		bimiDomain: bimiDomainFromPreview(preview),
		to: toAddresses.length ? toAddresses.join(', ') : (preview.recipients[0]?.address ?? ''),
		recipients: preview.recipients,
		init,
		bg: 'var(--pine-100)',
		fg: 'var(--pine-700)',
		epoch: storedAt.getTime(),
		subj: decodeWords(preview.subject || '') || '(no subject)',
		labels,
		unread: !item.read,
		starred: item.starred,
		snoozedUntil: item.snoozedUntil ?? null,
		prev: preview.snippet,
		body: [],
		threadCount: item.threadCount && item.threadCount > 1 ? item.threadCount : undefined,
		threadRootId: item.threadRootId ?? undefined,
		attachments:
			item.attachmentCount > 0
				? new Array(item.attachmentCount).fill({ name: 'attachment', size: '' })
				: undefined
	};
}

function fallbackRow(item: MessageListItem, code: string): Message {
	const storedAt = new Date(item.storedAt);
	return {
		id: item.id,
		folder: folderFromServer(item.mailboxState, item.direction),
		direction: item.direction,
		from: 'Encrypted message',
		fromAddr: '',
		to: '',
		recipients: [],
		init: '!',
		bg: 'var(--danger-100)',
		fg: 'var(--danger-700)',
		epoch: storedAt.getTime(),
		subj: `Could not decrypt preview (${code})`,
		labels: (item.labels ?? []) as LabelId[],
		unread: !item.read,
		starred: item.starred,
		snoozedUntil: item.snoozedUntil ?? null,
		prev: 'The preview ciphertext could not be opened with this device’s key.',
		body: []
	};
}

class MailboxStore {
	pinned = $state<Message | null>(null);

	#streams = $state(new Map<string, Stream>());
	#pending = new Map<string, Promise<void>>();
	#deepLinkPending = new Map<string, Promise<Message | null>>();
	#accountId: string | null = null;

	#counts = $state<MailboxCounts>({ inbox: 0, starred: 0, spam: 0, snoozed: 0 });
	#countsPending: Promise<void> | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.pinned = null;
		this.#streams = new Map();
		this.#pending.clear();
		this.#deepLinkPending.clear();
		this.#counts = { inbox: 0, starred: 0, spam: 0, snoozed: 0 };
		this.#countsPending = null;
	}

	get counts(): MailboxCounts {
		return this.#counts;
	}

	async refreshCounts(): Promise<void> {
		if (!auth.canEnterApp) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		if (this.#countsPending) return this.#countsPending;
		const run = (async () => {
			try {
				const next = await getMailboxCounts();
				if (this.#accountId !== accountId) return;
				this.#counts = next;
			} catch {
			} finally {
				this.#countsPending = null;
			}
		})();
		this.#countsPending = run;
		return run;
	}

	streamFor(query: Query): StreamSnapshot {
		const s = this.#streams.get(streamKey(query));
		if (!s) return EMPTY_SNAPSHOT;
		return {
			msgs: s.items,
			loading: s.loading,
			loadingMore: s.loadingMore,
			exhausted: s.exhausted,
			loadError: s.error
		};
	}

	async ensureLoaded(query: Query): Promise<void> {
		await this.#loadStream(query, false);
	}

	async loadMore(query: Query): Promise<void> {
		await this.#loadStream(query, true);
	}

	async refresh(queries: Query[]): Promise<void> {
		const seen = new Set<string>();
		const dedup: Query[] = [];
		for (const q of queries) {
			const k = streamKey(q);
			if (seen.has(k)) continue;
			seen.add(k);
			dedup.push(q);
		}
		await Promise.all(dedup.map((q) => this.#loadStream(q, false, true)));
	}

	patchMessage(id: string, patch: Partial<Message>) {
		const map = new Map(this.#streams);
		for (const [key, stream] of map) {
			const idx = stream.items.findIndex((m) => m.id === id);
			if (idx < 0) continue;
			const items = stream.items.slice();
			items[idx] = { ...items[idx], ...patch };
			map.set(key, { ...stream, items });
		}
		this.#streams = map;
		if (this.pinned?.id === id) this.pinned = { ...this.pinned, ...patch };
	}

	pin(m: Message | null) {
		this.pinned = m;
	}

	messagesFrom(address: string): Message[] {
		const wanted = address.trim().toLowerCase();
		if (!wanted) return [];
		const seen = new Set<string>();
		const out: Message[] = [];
		const consider = (m: Message) => {
			if (m.direction !== 'received') return;
			if ((m.fromAddr ?? '').trim().toLowerCase() !== wanted) return;
			if (seen.has(m.id)) return;
			seen.add(m.id);
			out.push(m);
		};
		for (const [, s] of this.#streams) {
			for (const m of s.items) consider(m);
		}
		if (this.pinned) consider(this.pinned);
		return out;
	}

	findMessage(id: string | null): Message | null {
		if (!id) return null;
		for (const [, s] of this.#streams) {
			const hit = s.items.find((m) => m.id === id);
			if (hit) return hit;
		}
		if (this.pinned?.id === id) return this.pinned;
		return null;
	}

	async ensureMessage(id: string): Promise<Message | null> {
		if (!auth.canEnterApp) return null;
		const accountId = auth.accountId;
		if (!accountId) return null;
		const cached = this.findMessage(id);
		if (cached) return cached;
		const pending = this.#deepLinkPending.get(id);
		if (pending) return pending;
		const run = (async () => {
			try {
				const detail = await getMessage(id);
				const adapted: MessageListItem = {
					id: detail.id,
					ownerAccountId: detail.ownerAccountId,
					direction: detail.direction,
					source: detail.source,
					storedAt: detail.storedAt,
					bodySizeBytes: 0,
					attachmentCount: detail.attachments.length,
					totalAttachmentBytes: 0,
					encryptedPreview: detail.encryptedPreview,
					previewKeyFingerprint: detail.previewKeyFingerprint,
					schemaVersion: detail.schemaVersion,
					mailboxState: detail.mailboxState,
					starred: detail.starred,
					starredAt: detail.starredAt,
					read: detail.read,
					readAt: detail.readAt,
					snoozedUntil: detail.snoozedUntil,
					threadRootId: detail.threadRootId,
					rsvpStatus: detail.rsvpStatus,
					labels: detail.labels
				};
				let msg: Message;
				try {
					msg = await decryptItem(accountId, adapted);
				} catch (err) {
					const code = err instanceof DecryptionError ? err.code : 'unknown';
					msg = fallbackRow(adapted, code);
				}
				if (this.#accountId !== accountId) return null;
				this.pin(msg);
				return msg;
			} catch {
				return null;
			} finally {
				this.#deepLinkPending.delete(id);
			}
		})();
		this.#deepLinkPending.set(id, run);
		return run;
	}

	#setStream(key: string, next: Stream) {
		const map = new Map(this.#streams);
		map.set(key, next);
		this.#streams = map;
	}

	#mergeMessages(target: Message[], incoming: Message[]): Message[] {
		const byId = new Map<string, Message>(target.map((m) => [m.id, m]));
		for (const item of incoming) byId.set(item.id, item);
		const seen = new Set<string>(target.map((m) => m.id));
		const out: Message[] = target.map((m) => byId.get(m.id) ?? m);
		for (const item of incoming) {
			if (!seen.has(item.id)) {
				out.push(byId.get(item.id) ?? item);
				seen.add(item.id);
			}
		}
		return out;
	}

	async #loadStream(query: Query, more: boolean, force = false): Promise<void> {
		if (!auth.canEnterApp) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		const threadOpts = threadOptionsFor(query);
		const listOpts = threadOpts ? null : listOptionsFor(query);
		if (!threadOpts && !listOpts) return;

		const key = streamKey(query);
		const pendingKey = key + (more ? '|+' : '');
		const existingPending = this.#pending.get(pendingKey);
		if (existingPending) return existingPending;

		const before = this.#streams.get(key) ?? emptyStream(query);
		if (more && (before.exhausted || !before.nextCursor)) return;
		if (!more && !force && before.items.length > 0) {
			return;
		}

		this.#setStream(key, {
			...before,
			loading: !more,
			loadingMore: more,
			error: null
		});

		const cursor = more ? before.nextCursor : undefined;
		const run = (async () => {
			try {
				let rows: { item: MessageListItem; thread: ThreadListItem | null }[];
				let nextCursor: string | null;
				if (threadOpts) {
					const resp = await listThreads({ ...threadOpts, cursor: cursor ?? undefined });
					rows = resp.items.map((t) => ({ item: t.latest, thread: t }));
					nextCursor = resp.nextCursor ?? null;
				} else {
					const resp = await listMessages({ ...listOpts!, cursor: cursor ?? undefined });
					rows = resp.items.map((item) => ({ item, thread: null }));
					nextCursor = resp.nextCursor ?? null;
				}
				if (this.#accountId !== accountId) return;
				const decrypted: Message[] = [];
				for (const { item, thread } of rows) {
					let msg: Message;
					try {
						msg = await decryptItem(accountId, item);
					} catch (err) {
						const code = err instanceof DecryptionError ? err.code : 'unknown';
						msg = fallbackRow(item, code);
					}
					decrypted.push(thread ? withThreadAggregates(msg, thread) : msg);
				}
				if (this.#accountId !== accountId) return;
				const current = this.#streams.get(key) ?? emptyStream(query);
				const merged = this.#mergeMessages(
					more ? current.items : decrypted,
					more ? decrypted : []
				);
				this.#setStream(key, {
					...current,
					items: merged,
					nextCursor,
					exhausted: !nextCursor,
					loading: false,
					loadingMore: false,
					error: null
				});
			} catch (err) {
				if (this.#accountId !== accountId) return;
				const current = this.#streams.get(key) ?? emptyStream(query);
				this.#setStream(key, {
					...current,
					loading: false,
					loadingMore: false,
					error: err instanceof Error ? err.message : 'Failed to load messages.'
				});
			} finally {
				this.#pending.delete(pendingKey);
			}
		})();
		this.#pending.set(pendingKey, run);
		return run;
	}
}

export const mailbox = new MailboxStore();
