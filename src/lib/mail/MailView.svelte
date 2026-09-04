<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import SystemAlerts from './SystemAlerts.svelte';
	import LifecycleBanners from '$lib/lifecycle/LifecycleBanners.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import MessageList, { type BulkAction } from './MessageList.svelte';
	import Reader from './Reader.svelte';
	import Compose from './Compose.svelte';
	import { mailSearch } from '$lib/stores/mailSearch.svelte';
	import { platform } from '$platform';
	import Toast from '$lib/components/Toast.svelte';
	import {
		FOLDERS,
		LABELS,
		countActiveFilters,
		folderFromServer,
		formatWhenLong,
		type LabelId,
		type ListFilters,
		type Message,
		type SortId
	} from './data';
	import {
		archiveMessage,
		deleteMessage,
		markMessageRead,
		markMessageSpam,
		markMessageUnread,
		restoreMessage,
		setMessageLabels,
		snoozeMessage,
		starMessage,
		trashMessage,
		unsnoozeMessage,
		unstarMessage
	} from '$lib/api/messages';
	import { returnedFromSnooze } from './timePresets';
	import type { MessageReportKind, MessageState } from '$lib/api/types';
	import { submitReport, type ReportOutcome } from './report';
	import { applyToThread, type ThreadVerb } from './threadActions';
	import { canFetchFolder, mailbox } from '$lib/stores/mailbox.svelte';
	import { drafts } from '$lib/stores/drafts.svelte';
	import { scheduled } from '$lib/stores/scheduled.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { composeStore } from '$lib/stores/compose.svelte';
	import { DEFAULT_QUERY, withFilters, type Query } from './url';
	import { mailActionsFor } from './actions';
	import { untrack } from 'svelte';

	interface Props {
		basePath: string;
		query: Query;
		messageId: string | null;
	}

	let { basePath, query, messageId }: Props = $props();

	const caps = $derived(mailActionsFor(query.folder));

	let checked = $state<Set<string>>(new Set());
	let toast = $state<{ text: string; undo?: () => void } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let deepLinkMissing = $state(false);

	const supported = $derived(canFetchFolder(query.folder));
	const snapshot = $derived(mailbox.streamFor(query));

	const filters = $derived<ListFilters>({
		unread: query.unread,
		starred: query.folder === 'starred',
		attach: query.attach,
		labels: query.labels
	});
	const sort = $derived<SortId>(query.sort);

	const folderLabel = $derived(
		query.folder === 'starred'
			? 'Starred'
			: (FOLDERS.find((f) => f.id === query.folder)?.label ?? 'Inbox')
	);

	const inFlight = new Map<string, Promise<void>>();

	function flash(text: string, undo?: () => void) {
		toast = { text, undo };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), undo ? 7000 : 2600);
	}

	function dismissToast() {
		clearTimeout(toastTimer);
		toast = null;
	}

	function withSearch(target: string): string {
		const qs = page.url.search;
		return qs ? `${target}${qs}` : target;
	}

	function openMessage(id: string) {
		void goto(withSearch(`${basePath}/${id}`));
	}

	function closeMessage(opts: { replace?: boolean } = {}) {
		void goto(withSearch(basePath), { replaceState: opts.replace ?? false });
	}


	function applyServerState(
		m: Message,
		state: MessageState,
		direction: 'sent' | 'received'
	): Message {
		return {
			...m,
			folder: folderFromServer(state.mailboxState, direction),
			starred: state.starred,
			unread: !state.read,
			snoozedUntil: state.snoozedUntil ?? null
		};
	}

	function directionFor(m: Message): 'sent' | 'received' {
		return m.direction;
	}

	function matchQ(m: Message): boolean {
		if (!mailSearch.text.trim()) return true;
		const q = mailSearch.text.toLowerCase();
		return [m.from, m.subj, m.prev, m.fromAddr, m.to].some((v) =>
			(v ?? '').toLowerCase().includes(q)
		);
	}

	let localHits = $state<string[] | null>(null);

	$effect(() => {
		const mirror = platform.mirror;
		const q = mailSearch.text.trim();
		const accountId = mailbox.accountId;
		if (!mirror || !q || !accountId) {
			localHits = null;
			return;
		}
		let cancelled = false;
		void mirror
			.search(accountId, q)
			.then((hits) => {
				if (!cancelled) localHits = hits.map((h) => h.id);
			})
			.catch(() => {
				if (!cancelled) localHits = null;
			});
		return () => {
			cancelled = true;
		};
	});

	const list = $derived(
		localHits === null
			? snapshot.msgs.filter(matchQ)
			: (() => {
					const order = new Map(localHits.map((id, i) => [id, i]));
					return snapshot.msgs
						.filter((m) => order.has(m.id))
						.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
				})()
	);
	const selected = $derived(mailbox.findMessage(messageId));

	$effect(() => {
		if (!supported || !auth.canEnterApp) return;
		void mailbox.ensureLoaded(query);
	});

	$effect(() => {
		const id = messageId;
		if (!id) {
			deepLinkMissing = false;
			return;
		}
		if (mailbox.findMessage(id)) {
			deepLinkMissing = false;
			return;
		}
		if (snapshot.loading) return;
		deepLinkMissing = false;
		void (async () => {
			const got = await mailbox.ensureMessage(id);
			if (!got && messageId === id) deepLinkMissing = true;
		})();
	});

	$effect(() => {
		mailbox.pin(selected);
	});

	$effect(() => {
		void query.folder;
		untrack(() => {
			checked = new Set();
			mailSearch.text = '';
			returnedDismissed = false;
		});
	});

	let returnedDismissed = $state(false);
	const returnedCount = $derived.by(() => {
		if (query.folder !== 'inbox' || returnedDismissed) return 0;
		const nowMs = Date.now();
		return list.filter((m) => returnedFromSnooze(m, nowMs)).length;
	});

	const pendingCount = $derived(mailbox.pendingFor(query));

	let atTop = $state(true);
	let tabVisible = $state(true);

	$effect(() => {
		if (typeof document === 'undefined') return;
		const onVis = () => (tabVisible = document.visibilityState === 'visible');
		onVis();
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});

	const autoFlush = $derived(
		sort === 'newest' &&
			countActiveFilters(filters) === 0 &&
			messageId === null &&
			atTop &&
			tabVisible
	);

	$effect(() => {
		mailbox.setAutoFlush(query, autoFlush);
		return () => mailbox.setAutoFlush(query, false);
	});

	const titleUnread = $derived(
		mailbox.counts.inbox > 99 ? '99+' : String(mailbox.counts.inbox)
	);

	const allChecked = $derived(list.length > 0 && list.every((m) => checked.has(m.id)));

	type StateAction = (id: string) => Promise<MessageState>;

	function queueStateUpdate(
		id: string,
		optimistic: Partial<Message>,
		action: StateAction,
		errMsg: string
	): Promise<void> {
		const current = mailbox.findMessage(id);
		if (!current) return Promise.resolve();
		const direction = directionFor(current);
		const snap: Partial<Message> = {
			folder: current.folder,
			starred: current.starred,
			snoozedUntil: current.snoozedUntil ?? null
		};
		mailbox.patchMessage(id, optimistic);
		const prev = inFlight.get(id) ?? Promise.resolve();
		const next = prev.then(async () => {
			try {
				const state = await action(id);
				const target = mailbox.findMessage(id);
				if (target) {
					mailbox.patchMessage(id, applyServerState(target, state, direction));
				}
				void mailbox.refreshCounts();
			} catch {
				mailbox.patchMessage(id, snap);
				flash(errMsg);
			}
		});
		inFlight.set(
			id,
			next.finally(() => {
				if (inFlight.get(id) === next) inFlight.delete(id);
			})
		);
		return next;
	}

	function isThread(m: Message | null | undefined): boolean {
		return !!m && (m.threadCount ?? 0) > 1;
	}

	function queueThreadUpdate(
		id: string,
		optimistic: Partial<Message>,
		verb: ThreadVerb,
		errMsg: string
	): Promise<void> {
		const current = mailbox.findMessage(id);
		if (!current) return Promise.resolve();
		const snap: Partial<Message> = {
			folder: current.folder,
			unread: current.unread
		};
		const rootId = current.threadRootId;
		mailbox.patchMessage(id, optimistic);
		const prev = inFlight.get(id) ?? Promise.resolve();
		const next = prev.then(async () => {
			try {
				const res = await applyToThread(id, rootId, verb);
				if (res.failed > 0) {
					flash(errMsg);
					await mailbox.refresh([query]);
				}
				void mailbox.refreshCounts();
			} catch {
				mailbox.patchMessage(id, snap);
				flash(errMsg);
			}
		});
		inFlight.set(
			id,
			next.finally(() => {
				if (inFlight.get(id) === next) inFlight.delete(id);
			})
		);
		return next;
	}

	function toggleStar(id: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		const wantStar = !current.starred;
		void queueStateUpdate(
			id,
			{ starred: wantStar },
			wantStar ? starMessage : unstarMessage,
			wantStar ? 'Could not star message' : 'Could not unstar message'
		);
	}

	function nextAfter(id: string): string | null {
		const i = list.findIndex((m) => m.id === id);
		if (i < 0) return null;
		return list[i + 1]?.id ?? list[i - 1]?.id ?? null;
	}

	function advancePast(id: string) {
		if (messageId !== id) return;
		const nextId = nextAfter(id);
		void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
	}

	function queueArchive(id: string): Promise<void> {
		advancePast(id);
		return isThread(mailbox.findMessage(id))
			? queueThreadUpdate(id, { folder: 'archive' }, 'archive', 'Could not archive')
			: queueStateUpdate(id, { folder: 'archive' }, archiveMessage, 'Could not archive');
	}

	function archiveOne(id: string) {
		void queueArchive(id);
		flash('Conversation archived');
	}

	function moveToInbox(id: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		advancePast(id);
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		if (isThread(current)) {
			void queueThreadUpdate(id, { folder: targetFolder }, 'inbox', 'Could not move to Inbox');
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, 'Could not move to Inbox');
		}
		flash('Moved to Inbox');
	}

	function snoozeOne(id: string, until: Date) {
		const iso = until.toISOString();
		advancePast(id);
		void queueStateUpdate(
			id,
			{ folder: 'snoozed', snoozedUntil: iso },
			(mid) => snoozeMessage(mid, iso),
			'Could not snooze'
		).then(() => mailbox.refresh([query]));
		flash(`Snoozed until ${formatWhenLong(until)}`, () => undoSnooze(id));
	}

	function unsnoozeOne(id: string, note = 'Back in the inbox') {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (current.folder === 'snoozed') advancePast(id);
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		void queueStateUpdate(
			id,
			{ folder: targetFolder, snoozedUntil: null },
			unsnoozeMessage,
			'Could not unsnooze'
		).then(() => mailbox.refresh([query]));
		flash(note);
	}

	function undoSnooze(id: string) {
		dismissToast();
		unsnoozeOne(id, 'Snooze cancelled');
	}

	function spamOne(id: string) {
		advancePast(id);
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { folder: 'spam' }, 'spam', 'Could not move to Spam');
		} else {
			void queueStateUpdate(id, { folder: 'spam' }, markMessageSpam, 'Could not move to Spam');
		}
		flash('Moved to Spam');
	}

	function moveToSpam(id: string): Promise<void> {
		return isThread(mailbox.findMessage(id))
			? queueThreadUpdate(id, { folder: 'spam' }, 'spam', 'Could not move to Spam')
			: queueStateUpdate(id, { folder: 'spam' }, markMessageSpam, 'Could not move to Spam');
	}

	async function reportAndSpam(id: string): Promise<ReportOutcome> {
		const accountId = auth.accountId;
		if (!accountId) throw new Error('Unlock this account to report the message.');
		const outcome = await submitReport(accountId, id, { kind: 'spam', includeHeaders: false });
		await moveToSpam(id);
		return outcome;
	}

	function reportOne(id: string) {
		advancePast(id);
		void reportAndSpam(id).then(
			() => flash('Reported as spam', () => undoReport(id)),
			() => flash('Could not report message')
		);
	}

	function reported(id: string, kind: MessageReportKind, outcome: ReportOutcome) {
		const alreadySpam = mailbox.findMessage(id)?.folder === 'spam';
		if (!alreadySpam) advancePast(id);
		void moveToSpam(id);
		const head = outcome.duplicate
			? 'Already reported, moved to Spam'
			: kind === 'phishing'
				? 'Reported as phishing and moved to Spam'
				: 'Reported as spam';
		const tail =
			outcome.headersRequested && !outcome.headersIncluded ? ' (headers could not be read)' : '';
		flash(head + tail, alreadySpam ? undefined : () => undoReport(id));
	}

	function undoReport(id: string) {
		dismissToast();
		const current = mailbox.findMessage(id);
		if (!current) return;
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		if (isThread(current)) {
			void queueThreadUpdate(id, { folder: targetFolder }, 'restore', 'Could not undo');
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, 'Could not undo');
		}
		flash('Moved back to Inbox');
	}

	function blockableFrom(address: string): Message[] {
		return mailbox
			.messagesFrom(address)
			.filter((m) => m.folder !== 'spam' && m.folder !== 'trash');
	}

	function blockedSender(address: string, moveExisting: boolean) {
		const targets = moveExisting ? blockableFrom(address) : [];
		if (messageId !== null && targets.some((m) => m.id === messageId)) {
			advancePast(messageId);
		}
		for (const m of targets) {
			void queueStateUpdate(m.id, { folder: 'spam' }, markMessageSpam, 'Could not move to Spam');
		}
		flash(
			targets.length > 0
				? `Blocked ${address} · ${targets.length} message${targets.length === 1 ? '' : 's'} moved to Spam`
				: `Blocked ${address}`
		);
	}

	async function moveToLabel(id: string, label: LabelId) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		const prev = current.labels ?? [];
		if (!prev.includes(label)) {
			const next = [...prev, label];
			mailbox.patchMessage(id, { labels: next });
			try {
				await setMessageLabels(id, { labels: next });
			} catch {
				mailbox.patchMessage(id, { labels: prev });
				flash('Could not apply the label');
				return;
			}
		}
		void queueArchive(id);
		flash(`Moved to ${LABELS[label].name}`);
	}

	function trashOne(id: string) {
		if (messageId === id) {
			const nextId = nextAfter(id);
			void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
		}
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { folder: 'trash' }, 'trash', 'Could not move to Trash');
		} else {
			void queueStateUpdate(id, { folder: 'trash' }, trashMessage, 'Could not move to Trash');
		}
		flash('Moved to Trash');
	}

	function restoreOne(id: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (messageId === id) {
			const nextId = nextAfter(id);
			void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
		}
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		if (isThread(current)) {
			void queueThreadUpdate(id, { folder: targetFolder }, 'restore', 'Could not restore');
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, 'Could not restore');
		}
		flash('Restored to Inbox');
	}

	async function deleteOne(id: string) {
		const ok = typeof window !== 'undefined'
			? window.confirm('Permanently delete this message? This cannot be undone.')
			: true;
		if (!ok) return;
		if (messageId === id) {
			const nextId = nextAfter(id);
			void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
		}
		try {
			await deleteMessage(id);
			flash('Permanently deleted');
			await mailbox.refresh([query]);
			void mailbox.refreshCounts();
		} catch {
			flash('Could not delete');
		}
	}

	function markRead(id: string) {
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { unread: false }, 'read', 'Could not mark read');
		} else {
			void queueStateUpdate(id, { unread: false }, markMessageRead, 'Could not mark read');
		}
	}

	function markUnread(id: string) {
		void queueStateUpdate(id, { unread: true }, markMessageUnread, 'Could not mark unread');
	}

	function toggleRead(id: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (current.unread) markRead(id);
		else markUnread(id);
	}

	function toggleCheck(id: string) {
		const next = new Set(checked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		checked = next;
	}

	function toggleAll() {
		checked = allChecked ? new Set() : new Set(list.map((m) => m.id));
	}

	async function bulk(action: BulkAction) {
		const ids = Array.from(checked);
		if (ids.length === 0) return;
		if (action === 'read') {
			checked = new Set();
			const results = await Promise.allSettled(
				ids.map((id) =>
					isThread(mailbox.findMessage(id))
						? queueThreadUpdate(id, { unread: false }, 'read', 'Could not mark read')
						: queueStateUpdate(id, { unread: false }, markMessageRead, 'Could not mark read')
				)
			);
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(`${ids.length} marked as read`);
			else if (failed < ids.length)
				flash(`${ids.length - failed} marked as read, ${failed} failed`);
			else flash('Mark as read failed');
			return;
		}
		if (action === 'restore') {
			if (messageId !== null && ids.includes(messageId)) {
				void goto(withSearch(basePath), { replaceState: true });
			}
			checked = new Set();
			const results = await Promise.allSettled(
				ids.map((id) => {
					const current = mailbox.findMessage(id);
					const targetFolder = current?.direction === 'sent' ? 'sent' : 'inbox';
					return isThread(current)
						? queueThreadUpdate(id, { folder: targetFolder }, 'restore', 'Could not restore')
						: queueStateUpdate(
								id,
								{ folder: targetFolder },
								restoreMessage,
								'Could not restore'
							);
				})
			);
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(`${ids.length} restored`);
			else if (failed < ids.length) flash(`${ids.length - failed} restored, ${failed} failed`);
			else flash('Restore failed');
			return;
		}
		if (action === 'delete') {
			const ok = typeof window !== 'undefined'
				? window.confirm(`Permanently delete ${ids.length} message${ids.length > 1 ? 's' : ''}? This cannot be undone.`)
				: true;
			if (!ok) return;
			if (messageId !== null && ids.includes(messageId)) {
				void goto(withSearch(basePath), { replaceState: true });
			}
			checked = new Set();
			const results = await Promise.allSettled(ids.map((id) => deleteMessage(id)));
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(`${ids.length} permanently deleted`);
			else if (failed < ids.length)
				flash(`${ids.length - failed} deleted, ${failed} failed`);
			else flash('Delete failed');
			await mailbox.refresh([query]);
			void mailbox.refreshCounts();
			return;
		}
		if (action === 'spam') {
			if (messageId !== null && ids.includes(messageId)) {
				void goto(withSearch(basePath), { replaceState: true });
			}
			checked = new Set();
			const results = await Promise.allSettled(ids.map((id) => reportAndSpam(id)));
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(`${ids.length} reported as spam`);
			else if (failed < ids.length)
				flash(`${ids.length - failed} reported as spam, ${failed} failed`);
			else flash('Report failed');
			return;
		}
		const verb: 'archive' | 'trash' = action;
		const optimistic: Partial<Message> = {
			folder: verb === 'archive' ? 'archive' : 'trash'
		};
		const fn: StateAction = verb === 'archive' ? archiveMessage : trashMessage;
		const label = verb === 'archive' ? 'archived' : 'moved to Trash';
		if (messageId !== null && ids.includes(messageId)) {
			void goto(withSearch(basePath), { replaceState: true });
		}
		checked = new Set();
		const results = await Promise.allSettled(
			ids.map((id) =>
				isThread(mailbox.findMessage(id))
					? queueThreadUpdate(id, optimistic, verb, `Could not ${verb} message`)
					: queueStateUpdate(id, optimistic, fn, `Could not ${verb} message`)
			)
		);
		const failed = results.filter((r) => r.status === 'rejected').length;
		if (failed === 0) {
			flash(`${ids.length} ${label}`);
		} else if (failed < ids.length) {
			flash(`${ids.length - failed} ${label}, ${failed} failed`);
		} else {
			flash(`${verb === 'archive' ? 'Archive' : 'Move to Trash'} failed`);
		}
	}

	function refreshAfterSend() {
		void mailbox.refresh([
			query,
			{ ...DEFAULT_QUERY, folder: 'inbox' },
			{ ...DEFAULT_QUERY, folder: 'sent' }
		]);
	}

	function send(info?: { scheduledAt?: string }) {
		composeStore.close();
		if (info?.scheduledAt) {
			flash(`Send scheduled for ${formatWhenLong(new Date(info.scheduledAt))}`);
			void scheduled.refresh();
		} else {
			flash('Message sent');
		}
		refreshAfterSend();
		void drafts.refresh();
	}

	function replySent() {
		flash('Reply sent');
		refreshAfterSend();
	}

	function replySentArchive(id: string) {
		flash('Reply sent and conversation archived');
		void queueArchive(id).then(refreshAfterSend);
	}

	function handleSort(id: SortId) {
		const search = withFilters(page.url.searchParams, { sort: id });
		void goto(`${basePath}${search}`);
	}

	function handleSetFilters(next: ListFilters) {
		const wantStarred = next.starred;
		const onStarred = query.folder === 'starred';
		if (wantStarred !== onStarred) {
			const slot = page.params.slot ?? '0';
			const target = wantStarred ? `/u/${slot}/mail/starred` : `/u/${slot}/mail/inbox`;
			const search = withFilters(new URLSearchParams(), {
				unread: next.unread,
				attach: next.attach,
				labels: next.labels
			});
			void goto(`${target}${search}`);
			return;
		}
		const search = withFilters(page.url.searchParams, {
			unread: next.unread,
			attach: next.attach,
			labels: next.labels
		});
		void goto(`${basePath}${search}`);
	}

	function handleLoadMore() {
		void mailbox.loadMore(query);
	}

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
		return target.isContentEditable;
	}

	function handleKey(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (composeStore.open) return;

		if (e.key === 'Escape') {
			if (messageId !== null) {
				e.preventDefault();
				closeMessage({ replace: true });
			}
		} else if (e.key === 'ArrowDown') {
			if (list.length === 0) return;
			e.preventDefault();
			if (messageId === null) {
				openMessage(list[0].id);
				return;
			}
			const i = list.findIndex((m) => m.id === messageId);
			if (i < 0) openMessage(list[0].id);
			else if (i < list.length - 1) openMessage(list[i + 1].id);
		} else if (e.key === 'ArrowUp') {
			if (list.length === 0) return;
			e.preventDefault();
			if (messageId === null) {
				openMessage(list[list.length - 1].id);
				return;
			}
			const i = list.findIndex((m) => m.id === messageId);
			if (i < 0) openMessage(list[0].id);
			else if (i > 0) openMessage(list[i - 1].id);
		} else if (e.key === 'Enter') {
			if (messageId === null && list.length > 0) {
				e.preventDefault();
				openMessage(list[0].id);
			}
		} else if (e.key.toLowerCase() === 'c' && !lifecycle.readOnly) {
			e.preventDefault();
			composeStore.openNew();
		}
	}
</script>

<svelte:head>
	<title>{mailbox.counts.inbox > 0 ? `(${titleUnread}) ` : ''}Thelemail — {folderLabel}</title>
</svelte:head>

<svelte:document onkeydown={handleKey} />

<LifecycleBanners />
<SystemAlerts />
<div class="mailbody" class:show-reader={messageId !== null}>
	{#if !supported}
		<section class="list">
			<div class="list-h">
				<div class="ttl-block">
					<span class="ttl">{folderLabel}</span>
				</div>
			</div>
			<div class="empty-folder">
				<p>{folderLabel} isn't available yet.</p>
				<p class="sub">This folder will light up once backend support lands.</p>
			</div>
		</section>
		<Reader
			m={null}
			{caps}
			onToggleStar={toggleStar}
			onArchive={archiveOne}
			onTrash={trashOne}
			onRestore={restoreOne}
			onDelete={deleteOne}
			onMarkRead={markRead}
			onMarkUnread={markUnread}
			onBack={() => closeMessage({ replace: true })}
		/>
	{:else}
		<MessageList
			{folderLabel}
			{list}
			activeId={messageId}
			{checked}
			{allChecked}
			{sort}
			{filters}
			{caps}
			onOpen={(m) => openMessage(m.id)}
			onToggleStar={toggleStar}
			onToggleCheck={toggleCheck}
			onArchive={archiveOne}
			onTrash={trashOne}
			onRestore={restoreOne}
			onDelete={deleteOne}
			onSpam={reportOne}
			onToggleRead={toggleRead}
			onToggleAll={toggleAll}
			onBulk={bulk}
			onSort={handleSort}
			onSetFilters={handleSetFilters}
			onRefresh={() => mailbox.refresh([query])}
			exhausted={snapshot.exhausted}
			loadingMore={snapshot.loadingMore}
			loadMoreError={snapshot.loadError}
			onLoadMore={handleLoadMore}
			{returnedCount}
			onDismissReturned={() => (returnedDismissed = true)}
			{pendingCount}
			onFlushPending={() => mailbox.flushPending(query)}
			onAtTopChange={(v) => (atTop = v)}
		/>
		{#if messageId && !selected && deepLinkMissing}
			<section class="reader reader-missing">
				<p>Message not found.</p>
				<p class="sub">It may have been deleted, or you may not have access.</p>
				<a class="back" href={withSearch(basePath)}>Back to {folderLabel}</a>
			</section>
		{:else}
			<Reader
				m={selected}
				{caps}
				onToggleStar={toggleStar}
				onArchive={archiveOne}
				onTrash={trashOne}
				onRestore={restoreOne}
				onDelete={deleteOne}
				onMarkRead={markRead}
				onMarkUnread={markUnread}
				onMoveToInbox={moveToInbox}
				onSpam={spamOne}
				onMoveToLabel={(id, label) => void moveToLabel(id, label)}
				onSnooze={snoozeOne}
				onUnsnooze={(id) => unsnoozeOne(id)}
				onReported={reported}
				onBlockedSender={blockedSender}
				blockedSenderCount={(address) => blockableFrom(address).length}
					onBack={() => closeMessage({ replace: true })}
				onReplySent={replySent}
				onReplySentArchive={replySentArchive}
			/>
		{/if}
	{/if}
</div>

{#if messageId === null && !composeStore.open}
	<button class="fab" title="Compose" onclick={() => composeStore.openNew()}>
		<PenLine size={22} />
	</button>
{/if}
{#if composeStore.open}
	{#key composeStore.editingDraftId}
		<Compose
			draftId={composeStore.editingDraftId}
			onClose={() => composeStore.close()}
			onSend={send}
		/>
	{/key}
{/if}
{#if toast}
	<Toast text={toast.text} onUndo={toast.undo} shift={131} />
{/if}
{#if snapshot.loadError}
	<Toast text={'Error: ' + snapshot.loadError} shift={131} />
{/if}
{#if snapshot.loading}
	<Toast text="Loading…" shift={131} />
{/if}

<style>
	.empty-folder {
		padding: 48px 24px;
		text-align: center;
		color: var(--ink-500);
	}
	.empty-folder .sub {
		margin-top: 6px;
		color: var(--ink-400);
		font-size: 13px;
	}
	.reader-missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		color: var(--ink-500);
		text-align: center;
		gap: 6px;
	}
	.reader-missing .sub {
		color: var(--ink-400);
		font-size: 13px;
	}
	.reader-missing .back {
		margin-top: 14px;
		color: var(--pine-700);
		text-decoration: underline;
		font-size: 13px;
	}
</style>
