<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { isListShortcut } from './shortcuts';
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
	import Inbox from '@lucide/svelte/icons/inbox';
	import Archive from '@lucide/svelte/icons/archive';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import MovePicker, { type SystemTarget, type SystemTargetId } from './MovePicker.svelte';
	import LabelPicker from './LabelPicker.svelte';
	import {
		chunk,
		labelStatesFromTallies,
		tallyOf,
		type CheckState,
		type LabelTally
	} from './collections/picker';
	import PickerScopeHeader from './collections/PickerScope.svelte';
	import {
		FOLDERS,
		countActiveFilters,
		customFolderId,
		customFolderRoute,
		customLabelId,
		folderFromServer,
		formatWhenLong,
		type ListFilters,
		type Message,
		type SortId,
		type ThreadEntry
	} from './data';
	import {
		archiveMessage,
		batchMoveMessages,
		countMailSelection,
		deleteMessage,
		labelMailSelection,
		markMessageRead,
		markMessageSpam,
		markMessageUnread,
		batchLabelMessages,
		moveMailSelection,
		moveMessage,
		moveMessageToInbox,
		restoreMessage,
		snoozeMessage,
		starMessage,
		trashMessage,
		unsnoozeMessage,
		unstarMessage
	} from '$core/api/messages';
	import { returnedFromSnooze } from './timePresets';
	import type {
		BatchMoveDestination,
		MailSelectionCount,
		MailSelectionProgress,
		MailSelector,
		MessageReportKind,
		MessageState
	} from '$core/api/types';
	import { submitReport, type ReportOutcome } from './report';
	import type { UnsubscribeMethod } from './unsubscribe';
	import { applyToThread, threadMessageIds, threadTargets, type ThreadVerb } from './threadActions';
	import { canFetchFolder, mailbox, selectorFor } from '$core/stores/mailbox.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
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
	let toast = $state<{ text: string; undo?: () => void; undoLabel?: string } | null>(null);
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
		labels: query.labels,
		direct: query.direct
	});

	const viewFolderId = $derived(customFolderId(query.folder));
	const viewLabelId = $derived(customLabelId(query.folder));
	const collectionKind = $derived<'folder' | 'label' | null>(
		viewFolderId ? 'folder' : viewLabelId ? 'label' : null
	);
	const showScope = $derived(mailCollections.hasChildren(viewFolderId ?? viewLabelId));
	const sort = $derived<SortId>(query.sort);

	const folderLabel = $derived(
		query.folder === 'starred'
			? msg.mail_folder_starred()
			: (FOLDERS.find((f) => f.id === query.folder)?.label ??
				mailCollections.folder(viewFolderId)?.name ??
				mailCollections.label(viewLabelId)?.name ??
				msg.mail_folder_inbox())
	);

	const inFlight = new Map<string, Promise<void>>();

	function flash(text: string, undo?: () => void, undoLabel?: string) {
		toast = { text, undo, undoLabel };
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
			folder: folderFromServer(state.mailboxState, direction, state.folderId),
			folderId: state.folderId ?? null,
			returnsToArchive: state.returnsToArchive,
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

	$effect(() => {
		if (!snapshot.missing) return;
		untrack(() => {
			flash(msg.mail_view_collection_gone());
			void goto(`/u/${page.params.slot ?? '0'}/mail/inbox`, { replaceState: true });
		});
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

	const viewUnread = $derived.by(() => {
		const counts = mailbox.counts;
		const scoped = (c: { direct: number; subtree: number } | undefined) =>
			c ? (query.direct ? c.direct : c.subtree) : 0;
		if (viewFolderId) return scoped(counts.folders[viewFolderId]);
		if (viewLabelId) return scoped(counts.labels[viewLabelId]);
		if (query.folder === 'spam') return counts.spam;
		return counts.inbox;
	});

	const titleUnread = $derived(viewUnread > 99 ? '99+' : String(viewUnread));

	const pageTitle = $derived(
		viewUnread > 0
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

	function isThread(id: string): boolean {
		return mailbox.threadSize(id) > 1;
	}

	function memberPatch(m: Message, optimistic: Partial<Message>): Partial<Message> {
		if (optimistic.folder !== 'inbox' && optimistic.folder !== 'sent') return optimistic;
		return { ...optimistic, folder: m.direction === 'sent' ? 'sent' : 'inbox' };
	}

	function queueThreadUpdate(
		id: string,
		optimistic: Partial<Message>,
		verb: ThreadVerb,
		errMsg: string,
		folderId?: string
	): Promise<void> {
		const current = mailbox.findMessage(id);
		if (!current) return Promise.resolve();
		const members = mailbox.threadMembers(id);
		const snaps = members.map((m) => ({ id: m.id, folder: m.folder, unread: m.unread }));
		const rootId = current.threadRootId;
		for (const m of members) mailbox.patchMessage(m.id, memberPatch(m, optimistic));
		const prev = inFlight.get(id) ?? Promise.resolve();
		const next = prev.then(async () => {
			try {
				const res = await applyToThread(id, rootId, verb, folderId);
				if (res.failed > 0) {
					flash(errMsg);
					await mailbox.refresh([query]);
				}
				void mailbox.refreshCounts();
			} catch {
				for (const s of snaps) mailbox.patchMessage(s.id, { folder: s.folder, unread: s.unread });
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

	const ARCHIVED: Partial<Message> = { folder: 'archive', folderId: null };

	function homeOf(current: Message): { route: string; folderName?: string; archive: boolean } {
		const homeFolder = current.folderId ? mailCollections.folder(current.folderId) : undefined;
		if (homeFolder) {
			return {
				route: customFolderRoute(homeFolder.id),
				folderName: homeFolder.name,
				archive: false
			};
		}
		if (current.returnsToArchive) return { route: 'archive', archive: true };
		return { route: current.direction === 'sent' ? 'sent' : 'inbox', archive: false };
	}

	function movedBackToast(home: ReturnType<typeof homeOf>, inbox: string): string {
		if (home.folderName) return msg.mail_toast_moved_back_to_folder({ folder: home.folderName });
		if (home.archive) return msg.mail_toast_moved_back_archive();
		return inbox;
	}

	function queueArchive(id: string): Promise<void> {
		advancePast(id);
		return isThread(id)
			? queueThreadUpdate(id, ARCHIVED, 'archive', msg.mail_err_archive())
			: queueStateUpdate(id, ARCHIVED, archiveMessage, msg.mail_err_archive());
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
		if (isThread(id)) {
			void queueThreadUpdate(
				id,
				{ folder: targetFolder, folderId: null, returnsToArchive: false },
				'inbox',
				msg.mail_err_move_inbox()
			);
		} else {
			void queueStateUpdate(
				id,
				{ folder: targetFolder, folderId: null, returnsToArchive: false },
				moveMessageToInbox,
				msg.mail_err_move_inbox()
			);
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

	function unsnoozeOne(id: string, note?: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (current.folder === 'snoozed') advancePast(id);
		const home = homeOf(current);
		void queueStateUpdate(
			id,
			{ folder: home.route, snoozedUntil: null, returnsToArchive: false },
			unsnoozeMessage,
			msg.mail_err_unsnooze()
		).then(() => mailbox.refresh([query]));
		flash(note ?? movedBackToast(home, msg.mail_toast_back_in_inbox()));
	}

	function undoSnooze(id: string) {
		dismissToast();
		unsnoozeOne(id, msg.mail_toast_snooze_cancelled());
	}

	function spamOne(id: string) {
		advancePast(id);
		if (isThread(id)) {
			void queueThreadUpdate(id, { folder: 'spam' }, 'spam', msg.mail_err_move_spam());
		} else {
			void queueStateUpdate(id, { folder: 'spam' }, markMessageSpam, msg.mail_err_move_spam());
		}
		flash(msg.mail_toast_moved_spam());
	}

	function moveToSpam(id: string): Promise<void> {
		return isThread(id)
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
		const home = homeOf(current);
		const optimistic = { folder: home.route, returnsToArchive: false };
		if (isThread(id)) {
			void queueThreadUpdate(id, optimistic, 'restore', msg.mail_err_undo());
		} else {
			void queueStateUpdate(id, optimistic, restoreMessage, msg.mail_err_undo());
		}
		flash(movedBackToast(home, msg.mail_toast_moved_back_inbox()));
	}

	function blockableFrom(address: string): Message[] {
		return mailbox
			.messagesFrom(address)
			.filter((m) => m.folder !== 'spam' && m.folder !== 'trash');
	}

	function unsubscribed(name: string, kind: UnsubscribeMethod['kind']) {
		flash(kind === 'mailto' ? msg.mail_toast_unsub_sent({ name }) : msg.mail_toast_unsubscribed({ name }));
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

	const MESSAGES_PER_BATCH = 200;
	const LABELS_PER_BATCH = 16;

	type LabelOutcome = 'ok' | 'limit' | 'failed';
	type PickerScope = 'conversation' | 'message';

	interface MoveTarget {
		destination: BatchMoveDestination;
		folderId?: string;
	}

	interface EntryTarget {
		id: string;
		rootId: string;
		labels: string[];
		folder: string;
	}

	interface QuerySelection {
		selector: MailSelector;
		count: MailSelectionCount;
	}

	function selectionMessages(ids: readonly string[]): Message[] {
		const out = new Map<string, Message>();
		for (const id of ids) {
			const members = isThread(id) ? mailbox.threadMembers(id) : [];
			const own = mailbox.findMessage(id);
			for (const m of own ? [own, ...members] : members) out.set(m.id, m);
		}
		return [...out.values()];
	}

	function withLabelChanges(labels: readonly string[], add: readonly string[], drop: ReadonlySet<string>): string[] {
		const next = labels.filter((l) => !drop.has(l));
		for (const l of add) if (!next.includes(l)) next.push(l);
		return next;
	}

	function countsAfter(m: Message, add: readonly string[], drop: ReadonlySet<string>): Record<string, number> | undefined {
		if (!m.labelCounts) return undefined;
		const next: Record<string, number> = {};
		for (const [id, n] of Object.entries(m.labelCounts)) if (!drop.has(id)) next[id] = n;
		for (const id of add) next[id] = m.threadCount ?? 1;
		return next;
	}

	async function sendLabels(
		messageIds: readonly string[],
		add: readonly string[],
		remove: readonly string[]
	): Promise<{ limited: string[]; missing: string[] }> {
		const addParts = chunk(add, LABELS_PER_BATCH);
		const removeParts = chunk(remove, LABELS_PER_BATCH);
		const rounds = Math.max(addParts.length, removeParts.length);
		const limited = new Set<string>();
		const missing = new Set<string>();
		for (const part of chunk(messageIds, MESSAGES_PER_BATCH)) {
			for (let i = 0; i < rounds; i++) {
				const { results } = await batchLabelMessages({
					messageIds: part,
					add: addParts[i],
					remove: removeParts[i]
				});
				for (const r of results) {
					if (r.outcome === 'too_many_labels') limited.add(r.messageId);
					if (r.outcome === 'not_found') missing.add(r.messageId);
					if (r.labelIds && mailbox.findMessage(r.messageId)) {
						mailbox.patchMessage(r.messageId, { labels: r.labelIds });
					}
				}
			}
		}
		return { limited: [...limited], missing: [...missing] };
	}

	async function applyLabels(
		ids: readonly string[],
		add: readonly string[],
		remove: readonly string[],
		scope: PickerScope = 'conversation',
		rootIds: readonly string[] = []
	): Promise<LabelOutcome> {
		if (add.length + remove.length === 0) return 'ok';
		const expand = scope === 'conversation';
		const local = expand
			? selectionMessages(ids)
			: ids.map((id) => mailbox.findMessage(id)).filter((m): m is Message => !!m);
		const snaps = local.map((m) => ({ id: m.id, labels: m.labels ?? [], labelCounts: m.labelCounts }));
		const drop = new Set(remove);
		for (const m of local) {
			const patch: Partial<Message> = { labels: withLabelChanges(m.labels ?? [], add, drop) };
			if (expand && ids.includes(m.id)) patch.labelCounts = countsAfter(m, add, drop);
			mailbox.patchMessage(m.id, patch);
		}
		accountSettings.recordRecents('labels', add);
		const threaded = expand ? ids.filter(isThread) : [];
		try {
			const targets = new Set(expand ? local.map((m) => m.id) : ids);
			const fetched = await Promise.all(
				threaded.map((id) => {
					const m = mailbox.findMessage(id);
					return m ? threadMessageIds(m.id, m.threadRootId) : Promise.resolve([]);
				})
			);
			for (const list of fetched) for (const id of list) targets.add(id);
			const { limited, missing } = await sendLabels([...targets], add, remove);
			for (const root of rootIds) mailbox.touchThread(root);
			if (threaded.length > 0 || limited.length > 0 || missing.length > 0) void mailbox.refresh([query]);
			if (limited.length > 0) {
				flash(msg.mail_err_too_many_labels());
				return 'limit';
			}
			if (missing.length > 0) {
				flash(msg.mail_bulk_labels_partial({ failed: missing.length }));
				return 'limit';
			}
			return 'ok';
		} catch {
			for (const snap of snaps) {
				mailbox.patchMessage(snap.id, { labels: snap.labels, labelCounts: snap.labelCounts });
			}
			flash(msg.mail_reader_labels_failed());
			void mailbox.refresh([query]);
			return 'failed';
		}
	}

	function movePatch(m: Message, target: MoveTarget): Partial<Message> {
		if (target.destination === 'folder' && target.folderId) {
			return { folder: customFolderRoute(target.folderId), folderId: target.folderId };
		}
		if (target.destination === 'archive') return ARCHIVED;
		return { folder: m.direction === 'sent' ? 'sent' : 'inbox', folderId: null, returnsToArchive: false };
	}

	async function moveMany(
		ids: readonly string[],
		target: MoveTarget,
		scope: PickerScope = 'conversation'
	): Promise<{ ok: number; failed: number }> {
		const plan = ids.map((id) => {
			const row = mailbox.findMessage(id);
			const thread = scope === 'conversation' && isThread(id);
			return { id, rootId: row?.threadRootId, members: row ? (thread ? mailbox.threadMembers(id) : [row]) : [], thread };
		});
		const snaps = plan.flatMap((p) =>
			p.members.map((m) => ({
				id: m.id,
				folder: m.folder,
				folderId: m.folderId ?? null,
				returnsToArchive: m.returnsToArchive
			}))
		);
		for (const p of plan) for (const m of p.members) mailbox.patchMessage(m.id, memberPatch(m, movePatch(m, target)));
		const folderId = target.destination === 'folder' ? target.folderId : undefined;
		try {
			const groups = await Promise.all(
				plan.map((p) => (p.thread ? threadTargets(p.id, p.rootId, 'move', folderId) : Promise.resolve([p.id])))
			);
			const failedIds = new Set<string>();
			for (const part of chunk([...new Set(groups.flat())], MESSAGES_PER_BATCH)) {
				const { results } = await batchMoveMessages({ messageIds: part, destination: target.destination, folderId });
				for (const r of results) {
					if (r.outcome !== 'ok' || !r.state) {
						failedIds.add(r.messageId);
						continue;
					}
					const known = mailbox.findMessage(r.messageId);
					if (known) mailbox.patchMessage(r.messageId, applyServerState(known, r.state, known.direction));
				}
			}
			const failed = plan.filter((_, i) => groups[i].some((id) => failedIds.has(id))).length;
			for (const p of plan) if (p.rootId) mailbox.touchThread(p.rootId);
			void mailbox.refreshCounts();
			if (failed > 0) void mailbox.refresh([query]);
			return { ok: plan.length - failed, failed };
		} catch {
			for (const s of snaps) mailbox.patchMessage(s.id, s);
			void mailbox.refresh([query]);
			return { ok: 0, failed: plan.length };
		}
	}

	function moveToast(target: MoveTarget, ok: number, failed: number): string {
		if (failed > 0 && ok === 0) {
			return target.destination === 'folder'
				? msg.mail_err_move_folder()
				: target.destination === 'archive'
					? msg.mail_bulk_archive_failed()
					: msg.mail_err_move_inbox();
		}
		if (failed > 0) {
			return target.destination === 'archive'
				? msg.mail_bulk_archived_partial({ ok, failed })
				: msg.mail_bulk_moved_partial({ ok, failed });
		}
		if (target.destination === 'folder') {
			return msg.mail_bulk_moved_to_folder({
				count: ok,
				folder: mailCollections.folder(target.folderId)?.path ?? ''
			});
		}
		return target.destination === 'archive'
			? msg.mail_bulk_archived({ count: ok })
			: msg.mail_bulk_moved_inbox({ count: ok });
	}

	async function moveSelected(ids: string[], target: MoveTarget) {
		if (messageId !== null && ids.includes(messageId)) {
			void goto(withSearch(basePath), { replaceState: true });
		}
		checked = new Set();
		const { ok, failed } = await moveMany(ids, target);
		flash(moveToast(target, ok, failed));
	}

	async function moveEntry(entry: EntryTarget, target: MoveTarget) {
		const { failed } = await moveMany([entry.id], target, 'message');
		void mailbox.refresh([query]);
		flash(failed > 0 ? moveToast(target, 0, 1) : moveToast(target, 1, 0));
	}

	async function moveEntryElsewhere(entry: EntryTarget, target: 'spam' | 'trash') {
		try {
			if (target === 'spam') await markMessageSpam(entry.id);
			else await trashMessage(entry.id);
			mailbox.touchThread(entry.rootId);
			void mailbox.refresh([query]);
			void mailbox.refreshCounts();
			flash(target === 'spam' ? msg.mail_toast_moved_spam() : msg.mail_toast_moved_trash());
		} catch {
			flash(target === 'spam' ? msg.mail_err_move_spam() : msg.mail_err_move_trash());
		}
	}

	async function labelAndArchive(ids: string[], labelId: string, scope: PickerScope = 'conversation') {
		const label = mailCollections.label(labelId)?.name ?? '';
		if ((await applyLabels(ids, [labelId], [], scope)) === 'failed') return;
		if (ids.length > 1) {
			await moveSelected(ids, { destination: 'archive' });
			return;
		}
		if (scope === 'message') {
			const { failed } = await moveMany(ids, { destination: 'archive' }, 'message');
			void mailbox.refresh([query]);
			flash(failed > 0 ? msg.mail_err_archive() : msg.mail_toast_moved_to_label({ label }));
			return;
		}
		void queueArchive(ids[0]);
		flash(msg.mail_toast_moved_to_label({ label }));
	}

	function queueFolderMove(id: string, folderId: string): Promise<void> {
		const patch: Partial<Message> = { folder: customFolderRoute(folderId), folderId };
		return isThread(id)
			? queueThreadUpdate(id, patch, 'move', msg.mail_err_move_folder(), folderId)
			: queueStateUpdate(
					id,
					patch,
					(mid) => moveMessage(mid, { folderId }),
					msg.mail_err_move_folder()
				);
	}

	function moveToFolder(id: string, folderId: string) {
		const current = mailbox.findMessage(id);
		if (!current) return;
		if (current.folder === customFolderRoute(folderId)) return;
		advancePast(id);
		void queueFolderMove(id, folderId);
		flash(msg.mail_toast_moved_to_folder({ folder: mailCollections.folder(folderId)?.name ?? '' }));
	}

	let querySelection = $state<QuerySelection | null>(null);
	let matching = $state<{ key: string; count: MailSelectionCount } | null>(null);
	let job = $state<{ verb: JobVerb; done: number; total: number; stopping: boolean } | null>(null);

	type JobVerb = 'move' | 'archive' | 'inbox' | 'labels';

	const viewSelector = $derived(mailSearch.active ? null : selectorFor(query));
	const selectorKey = $derived(viewSelector ? JSON.stringify(viewSelector) : null);
	const offerMatching = $derived(
		!!viewSelector && allChecked && !snapshot.exhausted && !querySelection && !job
	);

	$effect(() => {
		const key = selectorKey;
		const sel = viewSelector;
		if (!offerMatching || !key || !sel || matching?.key === key) return;
		void countMailSelection(sel).then(
			(count) => {
				if (selectorKey === key) matching = { key, count };
			},
			() => {}
		);
	});

	$effect(() => {
		void selectorKey;
		untrack(() => {
			querySelection = null;
			matching = null;
		});
	});

	const matchingTotal = $derived(matching && matching.key === selectorKey ? matching.count.units : null);

	function selectMatching() {
		const sel = viewSelector;
		const found = matching;
		if (!sel || !found || found.key !== selectorKey) return;
		querySelection = { selector: { ...sel, asOf: found.count.asOf }, count: found.count };
	}

	function clearSelection() {
		checked = new Set();
		querySelection = null;
	}

	interface SelectionStep {
		verb: JobVerb;
		run: (selector: MailSelector, cursor?: string) => Promise<MailSelectionProgress>;
		retry: (ids: string[]) => Promise<void>;
		done: (count: number) => string;
	}

	async function runSelection(steps: SelectionStep[]) {
		const sel = querySelection;
		if (!sel || job) return;
		const leaves = steps.some((s) => s.verb !== 'labels');
		if (leaves && messageId !== null) void goto(withSearch(basePath), { replaceState: true });
		querySelection = null;
		checked = new Set();
		const total = sel.count.units;
		const failures = new Map<string, string>();
		let outcome: 'done' | 'stopped' | 'error' = 'done';
		let last: SelectionStep = steps[0];
		for (const step of steps) {
			last = step;
			job = { verb: step.verb, done: 0, total, stopping: false };
			let cursor: string | undefined;
			try {
				do {
					const progress = await step.run(sel.selector, cursor);
					for (const f of progress.failures) failures.set(f.messageId, f.outcome);
					job.done = Math.min(total, job.done + progress.units);
					cursor = progress.nextCursor ?? undefined;
				} while (cursor && !job.stopping);
			} catch {
				outcome = 'error';
			}
			if (outcome === 'error') break;
			if (cursor) {
				outcome = 'stopped';
				break;
			}
		}
		const done = job?.done ?? 0;
		job = null;
		void mailbox.refresh([query]);
		void mailbox.refreshCounts();
		if (outcome === 'error') {
			flash(msg.mail_selection_failed({ done, total }));
			return;
		}
		if (outcome === 'stopped') {
			flash(msg.mail_selection_stopped({ done, total }));
			return;
		}
		const limited = [...failures.values()].filter((o) => o === 'too_many_labels').length;
		const retryable = [...failures].filter(([, o]) => o !== 'too_many_labels').map(([id]) => id);
		if (limited > 0 && retryable.length === 0) {
			flash(msg.mail_err_too_many_labels());
			return;
		}
		if (retryable.length > 0) {
			flash(
				msg.mail_selection_some_failed({ count: retryable.length }),
				() => {
					dismissToast();
					void last.retry(retryable);
				},
				msg.mail_selection_retry()
			);
			return;
		}
		flash(last.done(total));
	}

	function selectionMoveStep(target: MoveTarget, verb: JobVerb): SelectionStep {
		return {
			verb,
			run: (selector, cursor) =>
				moveMailSelection({ selector, cursor, destination: target.destination, folderId: target.folderId }),
			retry: async (ids) => {
				const { ok, failed } = await moveMany(ids, target, 'message');
				flash(moveToast(target, ok, failed));
			},
			done: (count) => moveToast(target, count, 0)
		};
	}

	function selectionLabelStep(add: string[], remove: string[]): SelectionStep {
		return {
			verb: 'labels',
			run: (selector, cursor) => labelMailSelection({ selector, cursor, add, remove }),
			retry: async (ids) => {
				const outcome = await applyLabels(ids, add, remove, 'message');
				if (outcome === 'ok') flash(msg.mail_toast_labels_updated());
			},
			done: () => msg.mail_toast_labels_updated()
		};
	}

	const jobText = $derived.by(() => {
		if (!job) return '';
		const counts = { done: formatCount(job.done), total: formatCount(job.total) };
		switch (job.verb) {
			case 'archive':
				return msg.mail_job_archiving(counts);
			case 'labels':
				return msg.mail_job_labelling(counts);
			default:
				return msg.mail_job_moving(counts);
		}
	});

	function stopJob() {
		if (job) job.stopping = true;
	}

	type PickerKind = 'move' | 'labels';

	let picker = $state<{
		kind: PickerKind;
		ids: string[];
		anchor: HTMLElement;
		initial: Map<string, CheckState>;
		scope: PickerScope;
		scopeable: boolean;
		entry: EntryTarget | null;
		query: QuerySelection | null;
	} | null>(null);

	const openPickerName = $derived(picker?.anchor.dataset.picker ?? null);

	function tallyFor(id: string): LabelTally[] {
		const row = mailbox.findMessage(id);
		if (!row) return [];
		if (row.labelCounts && (row.threadCount ?? 1) > 1) {
			return [{ counts: row.labelCounts, total: row.threadCount ?? 1 }];
		}
		if (isThread(id)) return mailbox.threadMembers(id).map((m) => tallyOf(m.labels ?? []));
		return [tallyOf(row.labels ?? [])];
	}

	function initialLabels(ids: readonly string[], scope: PickerScope, entry: EntryTarget | null, sel: QuerySelection | null) {
		if (sel) return labelStatesFromTallies([{ counts: sel.count.labelCounts, total: sel.count.messages }]);
		if (entry) return labelStatesFromTallies([tallyOf(entry.labels)]);
		if (scope === 'message') {
			return labelStatesFromTallies(ids.map((id) => tallyOf(mailbox.findMessage(id)?.labels ?? [])));
		}
		return labelStatesFromTallies(ids.flatMap(tallyFor));
	}

	function openPicker(
		kind: PickerKind,
		ids: string[],
		anchor: HTMLElement,
		opts: { scopeable?: boolean; entry?: EntryTarget } = {}
	) {
		if (picker && picker.anchor === anchor) {
			picker = null;
			return;
		}
		const sel = opts.entry ? null : querySelection;
		if (ids.length === 0 && !sel && !opts.entry) return;
		const entry = opts.entry ?? null;
		const scope: PickerScope = entry ? 'message' : 'conversation';
		const scopeable = !entry && !sel && !!opts.scopeable && ids.length === 1 && isThread(ids[0]);
		picker = {
			kind,
			ids: entry ? [entry.id] : ids,
			anchor,
			initial: kind === 'labels' ? initialLabels(ids, scope, entry, sel) : new Map(),
			scope,
			scopeable,
			entry,
			query: sel
		};
	}

	function setPickerScope(scope: PickerScope) {
		if (!picker || !picker.scopeable || picker.scope === scope) return;
		picker.scope = scope;
		if (picker.kind === 'labels') picker.initial = initialLabels(picker.ids, scope, null, null);
	}

	function openEntryPicker(kind: PickerKind, entry: ThreadEntry, rootId: string, anchor: HTMLElement) {
		if (!entry.id) return;
		openPicker(kind, [entry.id], anchor, {
			entry: { id: entry.id, rootId, labels: entry.labels ?? [], folder: entry.folder ?? 'inbox' }
		});
	}

	$effect(() => {
		void messageId;
		void query.folder;
		picker = null;
	});

	const pickerFolders = $derived.by<string[]>(() => {
		if (!picker) return [];
		const home = (route: string) => (route === 'sent' ? 'inbox' : route);
		if (picker.entry) return [home(picker.entry.folder)];
		if (picker.query) return viewFolderId ? [query.folder] : [];
		return picker.ids
			.map((id) => mailbox.findMessage(id))
			.filter((m): m is Message => !!m)
			.map((m) => home(m.folder));
	});

	const pickerSystemTargets = $derived.by<SystemTarget[]>(() => {
		const folders = pickerFolders;
		if (!picker || (folders.length === 0 && !picker.query)) return [];
		const allIn = (route: string) => folders.length > 0 && folders.every((f) => f === route);
		const out: SystemTarget[] = [];
		if (!allIn('inbox')) out.push({ id: 'inbox', label: msg.mail_folder_inbox(), icon: Inbox });
		if (!allIn('archive')) out.push({ id: 'archive', label: msg.mail_folder_archive(), icon: Archive });
		if (picker.query) return out;
		if (!allIn('spam')) out.push({ id: 'spam', label: msg.mail_folder_spam(), icon: ShieldAlert });
		if (!allIn('trash')) out.push({ id: 'trash', label: msg.mail_folder_trash(), icon: Trash2 });
		return out;
	});

	const pickerCurrentFolders = $derived.by(() => {
		const folders = pickerFolders;
		const id = folders[0] ? customFolderId(folders[0]) : null;
		if (!id || !folders.every((f) => f === folders[0])) return new Set<string>();
		return new Set([id]);
	});

	const pickerScopeText = $derived.by(() => {
		if (!picker) return '';
		if (picker.query) {
			return msg.mail_scope_query({ count: formatCount(picker.query.count.units), view: folderLabel });
		}
		if (picker.entry) return msg.mail_scope_message();
		if (picker.ids.length > 1) {
			const rows = picker.ids.map((id) => mailbox.findMessage(id)).filter((m): m is Message => !!m);
			const messages = rows.reduce((n, m) => n + Math.max(1, m.threadCount ?? 1), 0);
			if (messages > rows.length) {
				return msg.mail_scope_bulk({ count: rows.length, messages });
			}
		}
		return '';
	});

	const pickerConversationSize = $derived(
		picker?.scopeable ? (mailbox.findMessage(picker.ids[0])?.threadCount ?? mailbox.threadSize(picker.ids[0])) : 0
	);

	const pickerTouchesConversation = $derived(
		!!picker && !picker.entry && picker.scope === 'conversation' && (!!picker.query || picker.ids.some(isThread))
	);

	function formatCount(n: number): string {
		return new Intl.NumberFormat().format(n);
	}

	function takePicker() {
		const taken = picker;
		picker = null;
		return taken;
	}

	function pickSystem(target: SystemTargetId) {
		const taken = takePicker();
		if (!taken) return;
		accountSettings.recordRecents('move', [target]);
		if (taken.query) {
			if (target === 'inbox' || target === 'archive') {
				void runSelection([selectionMoveStep({ destination: target }, target)]);
			}
			return;
		}
		if (taken.entry) {
			if (target === 'inbox' || target === 'archive') void moveEntry(taken.entry, { destination: target });
			else void moveEntryElsewhere(taken.entry, target);
			return;
		}
		const ids = taken.ids;
		if (ids.length === 0) return;
		if (taken.scope === 'message') {
			const entry = entryForRow(ids[0]);
			if (!entry) return;
			if (target === 'inbox' || target === 'archive') void moveEntry(entry, { destination: target });
			else void moveEntryElsewhere(entry, target);
			return;
		}
		if (ids.length > 1) {
			if (target === 'inbox' || target === 'archive') void moveSelected(ids, { destination: target });
			else void bulk(target, ids);
			return;
		}
		const [id] = ids;
		if (target === 'inbox') moveToInbox(id);
		else if (target === 'archive') archiveOne(id);
		else if (target === 'spam') spamOne(id);
		else trashOne(id);
	}

	function entryForRow(id: string): EntryTarget | null {
		const row = mailbox.findMessage(id);
		if (!row) return null;
		return { id: row.id, rootId: row.threadRootId ?? row.id, labels: row.labels ?? [], folder: row.folder };
	}

	function pickFolder(folderId: string) {
		const taken = takePicker();
		if (!taken) return;
		accountSettings.recordRecents('move', [folderId]);
		const target: MoveTarget = { destination: 'folder', folderId };
		if (taken.query) {
			void runSelection([selectionMoveStep(target, 'move')]);
			return;
		}
		const entry = taken.entry ?? (taken.scope === 'message' ? entryForRow(taken.ids[0]) : null);
		if (entry) {
			void moveEntry(entry, target);
			return;
		}
		if (taken.ids.length > 1) void moveSelected(taken.ids, target);
		else if (taken.ids.length === 1) moveToFolder(taken.ids[0], folderId);
	}

	function pickLabelArchive(labelId: string) {
		const taken = takePicker();
		if (!taken) return;
		if (taken.query) {
			void runSelection([
				selectionLabelStep([labelId], []),
				selectionMoveStep({ destination: 'archive' }, 'archive')
			]);
			return;
		}
		const scope: PickerScope = taken.entry ? 'message' : taken.scope;
		if (taken.ids.length > 0) void labelAndArchive(taken.ids, labelId, scope);
	}

	function pickLabels(add: string[], remove: string[]) {
		const current = picker;
		if (!current) return;
		if (current.query) {
			picker = null;
			void runSelection([selectionLabelStep(add, remove)]);
			return;
		}
		const scope: PickerScope = current.entry ? 'message' : current.scope;
		const roots = current.entry
			? [current.entry.rootId]
			: current.ids.map((id) => mailbox.findMessage(id)?.threadRootId ?? id);
		void applyLabels(current.ids, add, remove, scope, roots).then((outcome) => {
			if (outcome === 'ok') flash(msg.mail_toast_labels_updated());
		});
	}

	function removeConversationLabel(id: string, labelId: string) {
		const row = mailbox.findMessage(id);
		const roots = row ? [row.threadRootId ?? row.id] : [];
		void applyLabels([id], [], [labelId], 'conversation', roots).then((outcome) => {
			if (outcome === 'ok') {
				flash(msg.mail_toast_label_removed({ label: mailCollections.label(labelId)?.name ?? '' }));
			}
		});
	}

	function trashOne(id: string) {
		if (messageId === id) {
			const nextId = nextAfter(id);
			void goto(withSearch(nextId ? `${basePath}/${nextId}` : basePath), { replaceState: true });
		}
		if (isThread(id)) {
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
		const home = homeOf(current);
		const optimistic = { folder: home.route, returnsToArchive: false };
		if (isThread(id)) {
			void queueThreadUpdate(id, optimistic, 'restore', msg.mail_err_restore());
		} else {
			void queueStateUpdate(id, optimistic, restoreMessage, msg.mail_err_restore());
		}
		flash(
			home.folderName
				? msg.mail_toast_restored_to_folder({ folder: home.folderName })
				: home.archive
					? msg.mail_toast_restored_archive()
					: msg.mail_toast_restored_inbox()
		);
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
		if (isThread(id)) {
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

	let rangeAnchor: string | null = null;

	function toggleCheck(id: string) {
		querySelection = null;
		const next = new Set(checked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		checked = next;
		rangeAnchor = id;
	}

	function selectRow(id: string, range: boolean) {
		const from = range && rangeAnchor ? list.findIndex((m) => m.id === rangeAnchor) : -1;
		const to = list.findIndex((m) => m.id === id);
		if (from < 0 || to < 0) {
			toggleCheck(id);
			return;
		}
		const on = !checked.has(id);
		const next = new Set(checked);
		for (const m of list.slice(Math.min(from, to), Math.max(from, to) + 1)) {
			if (on) next.add(m.id);
			else next.delete(m.id);
		}
		querySelection = null;
		checked = next;
		rangeAnchor = id;
	}

	function toggleAll() {
		const clearing = allChecked || !!querySelection;
		querySelection = null;
		rangeAnchor = null;
		checked = clearing ? new Set() : new Set(list.map((m) => m.id));
	}

	async function bulk(action: BulkAction, ids: string[] = Array.from(checked)) {
		if (querySelection) {
			if (action === 'archive') {
				await runSelection([selectionMoveStep({ destination: 'archive' }, 'archive')]);
			}
			return;
		}
		if (ids.length === 0) return;
		if (action === 'archive') {
			await moveSelected(ids, { destination: 'archive' });
			return;
		}
		if (action === 'read') {
			checked = new Set();
			const results = await Promise.allSettled(
				ids.map((id) =>
					isThread(id)
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
					return isThread(id)
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
		const optimistic: Partial<Message> = { folder: 'trash' };
		const errMsg = msg.mail_err_trash_message();
		if (messageId !== null && ids.includes(messageId)) {
			void goto(withSearch(basePath), { replaceState: true });
		}
		checked = new Set();
		const results = await Promise.allSettled(
			ids.map((id) =>
				isThread(id)
					? queueThreadUpdate(id, optimistic, 'trash', errMsg)
					: queueStateUpdate(id, optimistic, trashMessage, errMsg)
			)
		);
		const failed = results.filter((r) => r.status === 'rejected').length;
		if (failed === 0) flash(msg.mail_bulk_trashed({ count: ids.length }));
		else if (failed < ids.length) flash(msg.mail_bulk_trashed_partial({ ok: ids.length - failed, failed }));
		else flash(msg.mail_bulk_trash_failed());
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

	function replySent(id: string) {
		mailbox.noteReplySent(id);
		flash(msg.mail_toast_reply_sent());
		refreshAfterSend();
	}

	function replySentArchive(id: string) {
		mailbox.noteReplySent(id);
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
				labels: next.labels,
				direct: false
			});
			void goto(`${target}${search}`);
			return;
		}
		const search = withFilters(page.url.searchParams, {
			unread: next.unread,
			attach: next.attach,
			labels: next.labels,
			direct: !!next.direct
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
		if (!isListShortcut(e)) return;
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
		} else if ((e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'l') && !lifecycle.readOnly) {
			const kind = e.key.toLowerCase() === 'v' ? 'move' : 'labels';
			const source = checked.size > 0 ? 'bulk' : 'reader';
			const anchor = document.querySelector<HTMLElement>(`[data-picker="${source}-${kind}"]`);
			if (!anchor) return;
			e.preventDefault();
			anchor.click();
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
			onSelect={selectRow}
			viewFolder={query.folder}
			querySelected={querySelection ? querySelection.count.units : null}
			matchingTotal={offerMatching ? matchingTotal : undefined}
			onSelectMatching={selectMatching}
			onClearSelection={clearSelection}
			job={job ? { text: jobText, stopping: job.stopping } : null}
			onStopJob={stopJob}
			onBulk={bulk}
			onPicker={(kind, anchor) => openPicker(kind, Array.from(checked), anchor)}
			openPicker={openPickerName}
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
			{collectionKind}
			{showScope}
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
				viewFolder={query.folder}
				searching={mailSearch.active}
				onToggleStar={toggleStar}
				onArchive={archiveOne}
				onTrash={trashOne}
				onRestore={restoreOne}
				onDelete={deleteOne}
				onMarkRead={markRead}
				onMarkUnread={markUnread}
				onPicker={(kind, id, anchor) => openPicker(kind, [id], anchor, { scopeable: true })}
				onEntryPicker={openEntryPicker}
				onRemoveLabel={removeConversationLabel}
				openPicker={openPickerName}
				onSnooze={snoozeOne}
				onUnsnooze={(id) => unsnoozeOne(id)}
				onReported={reported}
				onBlockedSender={blockedSender}
				onUnsubscribed={unsubscribed}
				blockedSenderCount={(address) => blockableFrom(address).length}
					onBack={() => closeMessage({ replace: true })}
				onReplySent={replySent}
				onReplySentArchive={replySentArchive}
			/>
		{/if}
	{/if}
</div>

{#snippet pickerHeader()}
	{#if picker}
		<PickerScopeHeader
			text={pickerScopeText}
			toggle={picker.scopeable
				? { value: picker.scope, count: pickerConversationSize, onChange: setPickerScope }
				: null}
			future={picker.kind === 'labels' && pickerTouchesConversation}
		/>
	{/if}
{/snippet}

{#if picker?.kind === 'move'}
	<MovePicker
		anchor={picker.anchor}
		header={pickerHeader}
		systemTargets={pickerSystemTargets}
		currentFolders={pickerCurrentFolders}
		onSystem={pickSystem}
		onFolder={pickFolder}
		onLabelArchive={pickLabelArchive}
		onClose={() => (picker = null)}
	/>
{:else if picker?.kind === 'labels'}
	{#key picker.scope}
		<LabelPicker
			anchor={picker.anchor}
			header={pickerHeader}
			initial={picker.initial}
			onApply={pickLabels}
			onClose={() => (picker = null)}
		/>
	{/key}
{/if}

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
	<Toast text={toast.text} onUndo={toast.undo} undoLabel={toast.undoLabel} shift={131} />
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
