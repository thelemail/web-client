<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import SystemAlerts from './SystemAlerts.svelte';
	import UpdateBanner from './UpdateBanner.svelte';
	import LifecycleBanners from '$core/lifecycle/LifecycleBanners.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import MessageList, { type BulkAction } from './MessageList.svelte';
	import Reader from './Reader.svelte';
	import Compose from './Compose.svelte';
	import { mailSearch } from '$core/stores/search.svelte';
	import Toast from '$core/components/Toast.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
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
	} from '$core/api/messages';
	import { returnedFromSnooze } from './timePresets';
	import type { MessageReportKind, MessageState } from '$core/api/types';
	import { submitReport, type ReportOutcome } from './report';
	import { applyToThread, type ThreadVerb } from './threadActions';
	import { canFetchFolder, mailbox } from '$core/stores/mailbox.svelte';
	import { drafts } from '$core/stores/drafts.svelte';
	import { scheduled } from '$core/stores/scheduled.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import SpamConsentDialog from './SpamConsentDialog.svelte';
	import { composeStore } from '$core/stores/compose.svelte';
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
	let pendingDelete = $state<{ ids: string[]; bulk: boolean } | null>(null);
	let spamConsent = $state<{ resolve: (share: boolean | null) => void } | null>(null);
	let spamConsentBusy = $state(false);
	let spamConsentError = $state<string | null>(null);
	let deleting = $state(false);

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
			? msg.mail_folder_starred()
			: (FOLDERS.find((f) => f.id === query.folder)?.label ?? msg.mail_folder_inbox())
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

	const list = $derived(
		mailSearch.active
			? mailSearch.results.map((hit) => mailbox.findMessage(hit.id) ?? hit)
			: snapshot.msgs
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

	const routeFolder = $derived(query.folder);

	$effect(() => {
		void routeFolder;
		untrack(() => {
			checked = new Set();
			mailSearch.clear();
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

	const pageTitle = $derived(
		mailbox.counts.inbox > 0
			? msg.mail_page_title_unread({ count: titleUnread, folder: folderLabel })
			: msg.mail_page_title({ folder: folderLabel })
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
			wantStar ? msg.mail_err_star() : msg.mail_err_unstar()
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
			? queueThreadUpdate(id, { folder: 'archive' }, 'archive', msg.mail_err_archive())
			: queueStateUpdate(id, { folder: 'archive' }, archiveMessage, msg.mail_err_archive());
	}

	function archiveOne(id: string) {
		void queueArchive(id);
		flash(msg.mail_toast_archived());
	}

	function moveToInbox(id: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		advancePast(id);
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		if (isThread(current)) {
			void queueThreadUpdate(id, { folder: targetFolder }, 'inbox', msg.mail_err_move_inbox());
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, msg.mail_err_move_inbox());
		}
		flash(msg.mail_toast_moved_inbox());
	}

	function snoozeOne(id: string, until: Date) {
		const iso = until.toISOString();
		advancePast(id);
		void queueStateUpdate(
			id,
			{ folder: 'snoozed', snoozedUntil: iso },
			(mid) => snoozeMessage(mid, iso),
			msg.mail_err_snooze()
		).then(() => mailbox.refresh([query]));
		flash(msg.mail_toast_snoozed_until({ when: formatWhenLong(until) }), () => undoSnooze(id));
	}

	function unsnoozeOne(id: string, note = msg.mail_toast_back_in_inbox()) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (current.folder === 'snoozed') advancePast(id);
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		void queueStateUpdate(
			id,
			{ folder: targetFolder, snoozedUntil: null },
			unsnoozeMessage,
			msg.mail_err_unsnooze()
		).then(() => mailbox.refresh([query]));
		flash(note);
	}

	function undoSnooze(id: string) {
		dismissToast();
		unsnoozeOne(id, msg.mail_toast_snooze_cancelled());
	}

	function spamOne(id: string) {
		advancePast(id);
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { folder: 'spam' }, 'spam', msg.mail_err_move_spam());
		} else {
			void queueStateUpdate(id, { folder: 'spam' }, markMessageSpam, msg.mail_err_move_spam());
		}
		flash(msg.mail_toast_moved_spam());
	}

	function moveToSpam(id: string): Promise<void> {
		return isThread(mailbox.findMessage(id))
			? queueThreadUpdate(id, { folder: 'spam' }, 'spam', msg.mail_err_move_spam())
			: queueStateUpdate(id, { folder: 'spam' }, markMessageSpam, msg.mail_err_move_spam());
	}

	async function headersConsent(): Promise<boolean | null> {
		await accountSettings.hydrate();
		const saved = accountSettings.privacy.shareSpamHeaders;
		if (saved !== null) return saved;
		spamConsentError = null;
		return new Promise((resolve) => {
			spamConsent = { resolve };
		});
	}

	async function answerSpamConsent(share: boolean) {
		const pending = spamConsent;
		if (!pending) return;
		spamConsentBusy = true;
		spamConsentError = null;
		try {
			await accountSettings.persistShareSpamHeaders(share);
		} catch {
			spamConsentError = msg.mail_spam_consent_save_failed();
			return;
		} finally {
			spamConsentBusy = false;
		}
		spamConsent = null;
		pending.resolve(share);
	}

	function dismissSpamConsent() {
		const pending = spamConsent;
		spamConsent = null;
		pending?.resolve(null);
	}

	async function reportAndSpam(id: string, share: boolean): Promise<ReportOutcome> {
		const accountId = auth.accountId;
		if (!accountId) throw new Error(msg.mail_report_unlock_required());
		const outcome = await submitReport(accountId, id, {
			kind: 'spam',
			includeHeaders: share,
			senderAddress: share ? mailbox.findMessage(id)?.fromAddr : undefined
		});
		await moveToSpam(id);
		return outcome;
	}

	async function reportOne(id: string) {
		const share = await headersConsent();
		if (share === null) return;
		advancePast(id);
		void reportAndSpam(id, share).then(
			() => flash(msg.mail_toast_reported_spam(), () => undoReport(id)),
			() => flash(msg.mail_err_report())
		);
	}

	function reported(id: string, kind: MessageReportKind, outcome: ReportOutcome) {
		const alreadySpam = mailbox.findMessage(id)?.folder === 'spam';
		if (!alreadySpam) advancePast(id);
		void moveToSpam(id);
		const head = outcome.duplicate
			? msg.mail_toast_already_reported()
			: kind === 'phishing'
				? msg.mail_toast_reported_phishing()
				: msg.mail_toast_reported_spam();
		const text =
			outcome.headersRequested && !outcome.headersIncluded
				? msg.mail_toast_headers_unreadable({ head })
				: head;
		flash(text, alreadySpam ? undefined : () => undoReport(id));
	}

	function undoReport(id: string) {
		dismissToast();
		const current = mailbox.findMessage(id);
		if (!current) return;
		const targetFolder = current.direction === 'sent' ? 'sent' : 'inbox';
		if (isThread(current)) {
			void queueThreadUpdate(id, { folder: targetFolder }, 'restore', msg.mail_err_undo());
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, msg.mail_err_undo());
		}
		flash(msg.mail_toast_moved_back_inbox());
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
			void queueStateUpdate(m.id, { folder: 'spam' }, markMessageSpam, msg.mail_err_move_spam());
		}
		flash(
			targets.length > 0
				? msg.mail_toast_blocked_moved({ address, count: targets.length })
				: msg.mail_toast_blocked({ address })
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
				flash(msg.mail_err_label());
				return;
			}
		}
		void queueArchive(id);
		flash(msg.mail_toast_moved_to_label({ label: LABELS[label].name }));
	}

	function trashOne(id: string) {
		if (messageId === id) {
			const nextId = nextAfter(id);
			void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
		}
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { folder: 'trash' }, 'trash', msg.mail_err_move_trash());
		} else {
			void queueStateUpdate(id, { folder: 'trash' }, trashMessage, msg.mail_err_move_trash());
		}
		flash(msg.mail_toast_moved_trash());
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
			void queueThreadUpdate(id, { folder: targetFolder }, 'restore', msg.mail_err_restore());
		} else {
			void queueStateUpdate(id, { folder: targetFolder }, restoreMessage, msg.mail_err_restore());
		}
		flash(msg.mail_toast_restored_inbox());
	}

	function deleteOne(id: string) {
		pendingDelete = { ids: [id], bulk: false };
	}

	async function confirmDelete() {
		const pending = pendingDelete;
		if (!pending || deleting) return;
		const { ids, bulk: fromBulk } = pending;
		deleting = true;
		try {
			if (messageId !== null && ids.includes(messageId)) {
				const nextId = fromBulk ? null : nextAfter(messageId);
				void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
			}
			if (fromBulk) checked = new Set();
			const results = await Promise.allSettled(ids.map((id) => deleteMessage(id)));
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (!fromBulk) flash(failed === 0 ? msg.mail_toast_deleted_forever() : msg.mail_err_delete());
			else if (failed === 0) flash(msg.mail_bulk_deleted({ count: ids.length }));
			else if (failed < ids.length)
				flash(msg.mail_bulk_deleted_partial({ ok: ids.length - failed, failed }));
			else flash(msg.mail_bulk_delete_failed());
			await mailbox.refresh([query]);
			void mailbox.refreshCounts();
		} finally {
			deleting = false;
			pendingDelete = null;
		}
	}

	function markRead(id: string) {
		if (isThread(mailbox.findMessage(id))) {
			void queueThreadUpdate(id, { unread: false }, 'read', msg.mail_err_mark_read());
		} else {
			void queueStateUpdate(id, { unread: false }, markMessageRead, msg.mail_err_mark_read());
		}
	}

	function markUnread(id: string) {
		void queueStateUpdate(id, { unread: true }, markMessageUnread, msg.mail_err_mark_unread());
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
						? queueThreadUpdate(id, { unread: false }, 'read', msg.mail_err_mark_read())
						: queueStateUpdate(id, { unread: false }, markMessageRead, msg.mail_err_mark_read())
				)
			);
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(msg.mail_bulk_read({ count: ids.length }));
			else if (failed < ids.length)
				flash(msg.mail_bulk_read_partial({ ok: ids.length - failed, failed }));
			else flash(msg.mail_bulk_read_failed());
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
						? queueThreadUpdate(id, { folder: targetFolder }, 'restore', msg.mail_err_restore())
						: queueStateUpdate(
								id,
								{ folder: targetFolder },
								restoreMessage,
								msg.mail_err_restore()
							);
				})
			);
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(msg.mail_bulk_restored({ count: ids.length }));
			else if (failed < ids.length)
				flash(msg.mail_bulk_restored_partial({ ok: ids.length - failed, failed }));
			else flash(msg.mail_bulk_restore_failed());
			return;
		}
		if (action === 'delete') {
			pendingDelete = { ids, bulk: true };
			return;
		}
		if (action === 'spam') {
			const share = await headersConsent();
			if (share === null) return;
			if (messageId !== null && ids.includes(messageId)) {
				void goto(withSearch(basePath), { replaceState: true });
			}
			checked = new Set();
			const results = await Promise.allSettled(ids.map((id) => reportAndSpam(id, share)));
			const failed = results.filter((r) => r.status === 'rejected').length;
			if (failed === 0) flash(msg.mail_bulk_reported({ count: ids.length }));
			else if (failed < ids.length)
				flash(msg.mail_bulk_reported_partial({ ok: ids.length - failed, failed }));
			else flash(msg.mail_bulk_report_failed());
			return;
		}
		const verb: 'archive' | 'trash' = action;
		const optimistic: Partial<Message> = {
			folder: verb === 'archive' ? 'archive' : 'trash'
		};
		const fn: StateAction = verb === 'archive' ? archiveMessage : trashMessage;
		const archiving = verb === 'archive';
		const errMsg = archiving ? msg.mail_err_archive_message() : msg.mail_err_trash_message();
		if (messageId !== null && ids.includes(messageId)) {
			void goto(withSearch(basePath), { replaceState: true });
		}
		checked = new Set();
		const results = await Promise.allSettled(
			ids.map((id) =>
				isThread(mailbox.findMessage(id))
					? queueThreadUpdate(id, optimistic, verb, errMsg)
					: queueStateUpdate(id, optimistic, fn, errMsg)
			)
		);
		const failed = results.filter((r) => r.status === 'rejected').length;
		if (failed === 0) {
			flash(
				archiving
					? msg.mail_bulk_archived({ count: ids.length })
					: msg.mail_bulk_trashed({ count: ids.length })
			);
		} else if (failed < ids.length) {
			const counts = { ok: ids.length - failed, failed };
			flash(
				archiving ? msg.mail_bulk_archived_partial(counts) : msg.mail_bulk_trashed_partial(counts)
			);
		} else {
			flash(archiving ? msg.mail_bulk_archive_failed() : msg.mail_bulk_trash_failed());
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
			flash(msg.mail_toast_scheduled({ when: formatWhenLong(new Date(info.scheduledAt)) }));
			void scheduled.refresh();
		} else {
			flash(msg.mail_toast_sent());
		}
		refreshAfterSend();
		void drafts.refresh();
	}

	function replySent() {
		flash(msg.mail_toast_reply_sent());
		refreshAfterSend();
	}

	function replySentArchive(id: string) {
		flash(msg.mail_toast_reply_sent_archived());
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
	<title>{pageTitle}</title>
</svelte:head>

<svelte:document onkeydown={handleKey} />

<LifecycleBanners />
<UpdateBanner />
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
				<p>{msg.mail_folder_unavailable({ folder: folderLabel })}</p>
				<p class="sub">{msg.mail_folder_unavailable_detail()}</p>
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
			onSpam={(id) => void reportOne(id)}
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
			searchActive={mailSearch.active}
			searchPending={mailSearch.searching}
			searchIndexed={mailSearch.indexed}
			searchComplete={!mailSearch.partial}
			searchChips={mailSearch.chips}
			onClearSearch={() => mailSearch.clear()}
		/>
		{#if messageId && !selected && deepLinkMissing}
			<section class="reader reader-missing">
				<p>{msg.mail_not_found()}</p>
				<p class="sub">{msg.mail_not_found_detail()}</p>
				<a class="back" href={withSearch(basePath)}>{msg.mail_back_to_folder({ folder: folderLabel })}</a>
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
	<button class="fab" title={msg.mail_compose()} onclick={() => composeStore.openNew()}>
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
{#snippet deleteBody()}
	<p class="cfd-p">
		{pendingDelete && pendingDelete.ids.length > 1
			? msg.mail_delete_body_many()
			: msg.mail_delete_body_one()}
	</p>
{/snippet}

{#if spamConsent}
	<SpamConsentDialog
		busy={spamConsentBusy}
		error={spamConsentError}
		onAnswer={(share) => void answerSpamConsent(share)}
		onClose={dismissSpamConsent}
	/>
{/if}
{#if pendingDelete}
	<ConfirmDialog
		icon={Trash2}
		tone="danger"
		title={pendingDelete.ids.length > 1
			? msg.mail_delete_title_many({ count: pendingDelete.ids.length })
			: msg.mail_delete_title_one()}
		confirmLabel={msg.mail_delete_confirm()}
		busy={deleting}
		body={deleteBody}
		onConfirm={() => void confirmDelete()}
		onClose={() => {
			if (!deleting) pendingDelete = null;
		}}
	/>
{/if}
{#if toast}
	<Toast text={toast.text} onUndo={toast.undo} shift={131} />
{/if}
{#if snapshot.loadError}
	<Toast text={msg.mail_toast_error({ error: snapshot.loadError })} shift={131} />
{/if}
{#if snapshot.loading}
	<Toast text={msg.common_loading()} shift={131} />
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
