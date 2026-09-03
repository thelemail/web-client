<script lang="ts">
	import Reply from '@lucide/svelte/icons/reply';
	import { platform } from '$platform';
	import ReplyAll from '@lucide/svelte/icons/reply-all';
	import Forward from '@lucide/svelte/icons/forward';
	import Archive from '@lucide/svelte/icons/archive';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Mail from '@lucide/svelte/icons/mail';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Star from '@lucide/svelte/icons/star';
	import Clock from '@lucide/svelte/icons/clock';
	import FolderInput from '@lucide/svelte/icons/folder-input';
	import Tag from '@lucide/svelte/icons/tag';
	import { setMessageLabels } from '$lib/api/messages';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Code from '@lucide/svelte/icons/code';
	import Printer from '@lucide/svelte/icons/printer';
	import UserX from '@lucide/svelte/icons/user-x';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Avatar from './Avatar.svelte';
	import EmailBody from './EmailBody.svelte';
	import ReplyBox, { type ReplyMode } from './ReplyBox.svelte';
	import Thread from './Thread.svelte';
	import ReaderSkeleton from './ReaderSkeleton.svelte';
	import OriginalHeadersDialog from './OriginalHeadersDialog.svelte';
	import ReportDialog from './ReportDialog.svelte';
	import BlockSenderDialog from './BlockSenderDialog.svelte';
	import SnoozePicker from './SnoozePicker.svelte';
	import AnchoredMenu from './AnchoredMenu.svelte';
	import AlarmClockOff from '@lucide/svelte/icons/alarm-clock-off';
	import EventCard from './EventCard.svelte';
	import { untrack } from 'svelte';
	import { DecryptionError } from '$lib/mail/decrypt';
	import { auth } from '$lib/stores/auth.svelte';
	import { getMessage } from '$lib/api/messages';
	import { initialChips, type AttachmentChip } from '$lib/mail/attachments';
	import AttachmentList from '$lib/mail/AttachmentList.svelte';
	import { hydrateThread } from './hydrateThread';
	import TrustMark from './TrustMark.svelte';
	import { acceptSenderKeyChange } from './senderVerify';
	import { loadMessageBody } from './bodySource';
	import type { RenderResult, CalendarEvent } from '$lib/mail/render';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import {
		LABELS,
		plainSubject,
		formatWhenLong,
		type LabelId,
		type Message,
		type ThreadEntry
	} from './data';
	import type { MailActionCaps } from './actions';
	import type { MessageReportKind } from '$lib/api/types';
	import type { ReportOutcome } from './report';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import { mailbox } from '$lib/stores/mailbox.svelte';
	import { senderImage } from './senderImage';

	interface Props {
		m: Message | null;
		caps: MailActionCaps;
		onToggleStar: (id: string) => void;
		onArchive: (id: string) => void;
		onTrash: (id: string) => void;
		onRestore?: (id: string) => void;
		onDelete?: (id: string) => void;
		onMarkRead?: (id: string) => void;
		onMarkUnread?: (id: string) => void;
		onMoveToInbox?: (id: string) => void;
		onSpam?: (id: string) => void;
		onMoveToLabel?: (id: string, label: LabelId) => void;
		onSnooze?: (id: string, until: Date) => void;
		onUnsnooze?: (id: string) => void;
		onReported?: (id: string, kind: MessageReportKind, outcome: ReportOutcome) => void;
		onBlockedSender?: (address: string, moveExisting: boolean) => void;
		blockedSenderCount?: (address: string) => number;
		onReplySent?: () => void;
		onReplySentArchive?: (id: string) => void;
		onBack?: () => void;
	}

	let {
		m,
		caps,
		onToggleStar,
		onArchive,
		onTrash,
		onRestore,
		onDelete,
		onMarkRead,
		onMarkUnread,
		onMoveToInbox,
		onSpam,
		onMoveToLabel,
		onSnooze,
		onUnsnooze,
		onReported,
		onBlockedSender,
		blockedSenderCount,
		onReplySent,
		onReplySentArchive,
		onBack
	}: Props = $props();

	const img = $derived(senderImage(m?.fromAddr, m?.bimiDomain));

	let moreOpen = $state(false);
	let moreRef: HTMLDivElement | undefined = $state();
	let morePanel: HTMLDivElement | undefined = $state();

	let labelPickerOpen = $state(false);
	let labelPickerRef: HTMLDivElement | undefined = $state();
	let movePickerOpen = $state(false);
	let movePickerRef: HTMLDivElement | undefined = $state();
	let snoozePickerOpen = $state(false);
	let headersOpen = $state(false);
	let reportOpen = $state(false);
	let blockOpen = $state(false);
	let labelSaving = $state(false);
	let labelError = $state<string | null>(null);
	const labelOptions = Object.entries(LABELS) as [LabelId, (typeof LABELS)[LabelId]][];
	const currentLabels = $derived<LabelId[]>(((m?.labels ?? []) as LabelId[]));

	async function toggleLabel(id: LabelId) {
		if (!m?.id || labelSaving) return;
		const has = currentLabels.includes(id);
		const next: LabelId[] = has
			? currentLabels.filter((l) => l !== id)
			: [...currentLabels, id];
		const messageId = m.id;
		labelSaving = true;
		labelError = null;
		mailbox.patchMessage(messageId, { labels: next });
		try {
			await setMessageLabels(messageId, { labels: next });
		} catch (e) {
			mailbox.patchMessage(messageId, { labels: currentLabels });
			labelError = e instanceof Error ? e.message : 'Could not update labels';
		} finally {
			labelSaving = false;
		}
	}

	type MoveTargetId = 'inbox' | 'archive' | 'spam' | 'trash';
	type MoveTarget = { id: MoveTargetId; label: string; icon: typeof Inbox };

	const moveTargets = $derived.by<MoveTarget[]>(() => {
		if (!m) return [];
		const out: MoveTarget[] = [];
		if (m.folder !== 'inbox' && m.direction !== 'sent') {
			out.push({ id: 'inbox', label: 'Inbox', icon: Inbox });
		}
		if (m.folder !== 'archive') out.push({ id: 'archive', label: 'Archive', icon: Archive });
		if (m.folder !== 'spam') out.push({ id: 'spam', label: 'Spam', icon: ShieldAlert });
		if (m.folder !== 'trash') out.push({ id: 'trash', label: 'Trash', icon: Trash2 });
		return out;
	});

	function moveTo(target: MoveTargetId) {
		if (!m) return;
		movePickerOpen = false;
		switch (target) {
			case 'inbox':
				onMoveToInbox?.(m.id);
				return;
			case 'archive':
				onArchive(m.id);
				return;
			case 'spam':
				onSpam?.(m.id);
				return;
			case 'trash':
				onTrash(m.id);
		}
	}

	function moveToLabel(id: LabelId) {
		if (!m) return;
		movePickerOpen = false;
		onMoveToLabel?.(m.id, id);
	}

	function snoozeUntil(when: Date) {
		if (!m) return;
		snoozePickerOpen = false;
		onSnooze?.(m.id, when);
	}

	const snoozeState = $derived.by<{ kind: 'pending' | 'returned'; at: Date } | null>(() => {
		if (!m?.snoozedUntil) return null;
		const t = Date.parse(m.snoozedUntil);
		if (!Number.isFinite(t)) return null;
		const at = new Date(t);
		if (m.folder === 'snoozed') return { kind: 'pending', at };
		if (t <= Date.now()) return { kind: 'returned', at };
		return null;
	});

	const senderAddress = $derived((m?.fromAddr ?? '').trim());
	const canReport = $derived(
		!!m && !!onReported && m.direction === 'received' && m.folder !== 'trash'
	);
	const canBlock = $derived(
		!!m && !!onBlockedSender && m.direction === 'received' && senderAddress.length > 0
	);
	const alsoInMailbox = $derived(
		blockOpen && senderAddress ? (blockedSenderCount?.(senderAddress) ?? 0) : 0
	);

	function handleDocMouseDown(e: MouseEvent) {
		const inMore =
			(moreRef && moreRef.contains(e.target as Node)) ||
			(morePanel && morePanel.contains(e.target as Node));
		if (moreOpen && !inMore) moreOpen = false;
		if (labelPickerOpen && labelPickerRef && !labelPickerRef.contains(e.target as Node)) {
			labelPickerOpen = false;
		}
		if (movePickerOpen && movePickerRef && !movePickerRef.contains(e.target as Node)) {
			movePickerOpen = false;
		}
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (movePickerOpen) {
			movePickerOpen = false;
			e.stopPropagation();
			return;
		}
		if (labelPickerOpen) {
			labelPickerOpen = false;
			e.stopPropagation();
			return;
		}
		if (moreOpen) {
			moreOpen = false;
			e.stopPropagation();
		}
	}

	let lastMessageId: string | null = null;
	$effect(() => {
		const id = m?.id ?? null;
		if (id !== lastMessageId) {
			lastMessageId = id;
			moreOpen = false;
			labelPickerOpen = false;
			movePickerOpen = false;
			snoozePickerOpen = false;
			headersOpen = false;
			reportOpen = false;
			blockOpen = false;
			replyMode = null;
		}
	});

	const openedId = $derived(m?.id ?? null);
	$effect(() => {
		const id = openedId;
		const hydrated = accountSettings.hydrated;
		if (!id || !hydrated) return;
		const isUnread = untrack(() => !!m?.unread);
		if (!isUnread) return;
		const delay = untrack(() => accountSettings.markReadDelayMs);
		if (delay === null) return;
		const handle = setTimeout(() => {
			const latest = mailbox.findMessage(id);
			if (latest && latest.unread) onMarkRead?.(id);
		}, delay);
		return () => clearTimeout(handle);
	});

	type BodyState =
		| { id: string; status: 'loading' }
		| { id: string; status: 'ready'; render: RenderResult; attachments: AttachmentChip[] }
		| { id: string; status: 'error'; error: string };

	const BODY_MAX_ATTEMPTS = 3;
	const BODY_RETRY_BASE_MS = 800;

	let bodyState = $state<BodyState | null>(null);
	let bodyRetryTick = $state(0);
	let bodyAttempts = 0;
	const openedMessageId = $derived(m?.id ?? null);

	type ThreadMeta = {
		id: string;
		entries: Message['thread'];
		trust?: NonNullable<Message['thread']>[number]['trust'];
		rsvpStatus?: Message['rsvpStatus'];
		rsvpEventUid?: string;
		externalMessageId?: string;
		references?: string[];
	};
	let threadMeta = $state<ThreadMeta | null>(null);
	let threadRefreshTick = $state(0);
	let threadSeenTick = 0;

	const currentThreadRootId = $derived(m?.threadRootId ?? m?.id ?? null);
	const seenThreadTicks = new Map<string, number>();

	$effect(() => {
		const rootId = currentThreadRootId;
		if (!rootId) return;
		const tick = mailbox.threadTick(rootId);
		const seen = seenThreadTicks.get(rootId);
		if (seen === undefined) {
			seenThreadTicks.set(rootId, tick);
			return;
		}
		if (seen === tick) return;
		seenThreadTicks.set(rootId, tick);
		threadRefreshTick += 1;
	});

	let replyMode = $state<ReplyMode | null>(null);

	function toggleReplyMode(next: ReplyMode) {
		replyMode = replyMode === next ? null : next;
	}

	const readerTrust = $derived(
		threadMeta && m && threadMeta.id === m.id ? threadMeta.trust : undefined
	);

	async function confirmKeyChange(address: string) {
		const accountId = auth.accountId;
		if (!accountId) return;
		await acceptSenderKeyChange(accountId, address);
		threadRefreshTick += 1;
	}

	const enriched = $derived.by<Message | null>(() => {
		if (!m) return null;
		const meta = threadMeta;
		if (!meta || meta.id !== m.id) return m;
		return {
			...m,
			thread: meta.entries && meta.entries.length > 1 ? meta.entries : m.thread,
			threadCount: meta.entries?.length ?? m.threadCount,
			rsvpStatus: meta.rsvpStatus ?? m.rsvpStatus,
			rsvpEventUid: meta.rsvpEventUid ?? m.rsvpEventUid,
			externalMessageId: meta.externalMessageId ?? m.externalMessageId,
			references: meta.references ?? m.references
		};
	});

	const replySeed = $derived.by<ThreadEntry | null>(() => {
		const t = enriched?.thread;
		if (!t || t.length === 0) return null;
		return t[t.length - 1];
	});

	$effect(() => {
		const current = m;
		const tick = threadRefreshTick;
		if (!current) {
			threadMeta = null;
			threadSeenTick = tick;
			return;
		}
		if (threadMeta?.id === current.id && threadSeenTick === tick) return;
		threadSeenTick = tick;
		void (async () => {
			try {
				const hydrated = await hydrateThread(current.id);
				if (!hydrated) {
					threadMeta = null;
					return;
				}
				const seedEntry =
					hydrated.entries.find((e) => e.id === current.id) ??
					hydrated.entries[hydrated.entries.length - 1];
				threadMeta = {
					id: current.id,
					entries: hydrated.entries,
					trust: seedEntry?.trust,
					rsvpStatus: hydrated.rsvpStatus,
					rsvpEventUid: hydrated.rsvpEventUid,
					externalMessageId: hydrated.externalMessageId,
					references: hydrated.references
				};
				cascadeMarkRead(hydrated.entries ?? []);
			} catch (err) {
				console.warn('Thread hydration failed', err);
			}
		})();
	});

	function cascadeMarkRead(entries: NonNullable<Message['thread']>) {
		const delay = accountSettings.markReadDelayMs;
		if (delay === null) return;
		const seedId = m?.id;
		for (const e of entries) {
			if (!e.id || e.id === seedId) continue;
			if (e.me) continue;
			const row = mailbox.findMessage(e.id);
			if (!row?.unread) continue;
			const entryId = e.id;
			setTimeout(() => {
				const latest = mailbox.findMessage(entryId);
				if (latest?.unread) onMarkRead?.(entryId);
			}, delay);
		}
	}

	$effect(() => {
		const current = m;
		void bodyRetryTick;
		if (!current) {
			bodyState = null;
			bodyAttempts = 0;
			return;
		}
		const previous = untrack(() => bodyState);
		if (previous?.id === current.id && previous.status !== 'error') {
			return;
		}
		const attempt = previous?.id === current.id ? bodyAttempts + 1 : 1;
		bodyAttempts = attempt;
		bodyState = { id: current.id, status: 'loading' };
		void (async () => {
			try {
				const stripTracking = accountSettings.privacy.stripTrackingParams;
				const accountId = auth.accountId;
				if (!accountId) throw new DecryptionError('locked');
				const { detail, render } = await loadMessageBody(accountId, current.id, {
					stripTracking
				});
				const chips = initialChips(detail.attachments ?? []);
				if (bodyState?.id !== current.id) return;
				bodyState = { id: current.id, status: 'ready', render, attachments: chips };
			} catch (err) {
				platform.reportError?.('body', err);
				if (bodyState?.id !== current.id) return;
				const msgText =
					err instanceof DecryptionError
						? err.code
						: err instanceof Error
							? err.message
							: 'failed';
				bodyState = { id: current.id, status: 'error', error: msgText };
				if (attempt < BODY_MAX_ATTEMPTS) {
					setTimeout(
						() => {
							if (untrack(() => bodyState)?.id === current.id) bodyRetryTick += 1;
						},
						BODY_RETRY_BASE_MS * 2 ** (attempt - 1)
					);
				}
			}
		})();
	});

	const STATUS_SRCDOC: Record<'loading' | 'error', (msg?: string) => string> = {
		loading: () =>
			'<!doctype html><html><body style="font-family:sans-serif;color:#6B7360;font-size:13px;padding:6px 2px">Decrypting…</body></html>',
		error: (msg) =>
			`<!doctype html><html><body style="font-family:sans-serif;color:#8E2F26;font-size:13px;padding:6px 2px">Failed to decrypt body: ${escapeForHtml(msg ?? '')}</body></html>`
	};

	function escapeForHtml(s: string): string {
		return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
	}

	const bodySrcDoc = $derived.by<string>(() => {
		if (!bodyState) return STATUS_SRCDOC.loading();
		if (bodyState.status === 'loading') return STATUS_SRCDOC.loading();
		if (bodyState.status === 'error') return STATUS_SRCDOC.error(bodyState.error);
		return bodyState.render.srcDoc;
	});

	const quotedSrcDoc = $derived(
		bodyState?.status === 'ready' ? bodyState.render.quoted?.srcDoc ?? null : null
	);
	const isForwarded = $derived(
		bodyState?.status === 'ready' ? bodyState.render.forwarded === true : false
	);
	const calendarEvents = $derived<CalendarEvent[]>(
		bodyState?.status === 'ready' ? bodyState.render.calendarEvents : []
	);
	const attachmentChips = $derived<AttachmentChip[]>(
		bodyState?.status === 'ready' ? bodyState.attachments : []
	);
	const isThreadView = $derived(
		Math.max(enriched?.thread?.length ?? 0, m?.threadCount ?? 0) > 1
	);

	async function refreshPointer(attachmentId: string) {
		const id = m?.id;
		if (!id) return null;
		const detail = await getMessage(id);
		return detail.attachments?.find((a) => a.id === attachmentId)?.pointer ?? null;
	}
	function formatEventRange(ev: CalendarEvent): string {
		const start = ev.start?.display ?? '';
		const end = ev.end?.display ?? '';
		if (!start) return '';
		if (!end || start === end) return start;
		return `${start} → ${end}`;
	}
	let showQuoted = $state(false);
	$effect(() => {
		void openedMessageId;
		showQuoted = false;
	});
</script>

<svelte:document onmousedown={handleDocMouseDown} onkeydown={handleKey} />

<section class="reader">
	{#if !m}
		<div class="reader-empty">
			<div class="t">Nothing open</div>
			<div class="d">Pick a message from the list to read it here.</div>
			<div class="re-hints">
				<span><kbd>↑</kbd><kbd>↓</kbd> move</span>
				<span><kbd>↵</kbd> open</span>
				<span><kbd>C</kbd> compose</span>
			</div>
		</div>
	{:else if bodyState?.status === 'loading'}
		<ReaderSkeleton {onBack} />
	{:else}
		<div class="reader-bar">
			<button class="rb-ico rb-back" title="Back to list" onclick={() => onBack?.()}>
				<ArrowLeft size={17} />
			</button>
			{#if caps.showReply}
				<button
					type="button"
					class="rb-btn primary"
					class:on={replyMode === 'reply'}
					onclick={() => toggleReplyMode('reply')}
				>
					<Reply size={15} /><span class="rb-t">Reply</span>
				</button>
				<button
					type="button"
					class="rb-btn"
					class:on={replyMode === 'all'}
					onclick={() => toggleReplyMode('all')}
				>
					<ReplyAll size={15} /><span class="rb-t">Reply all</span>
				</button>
				<button
					type="button"
					class="rb-btn"
					class:on={replyMode === 'forward'}
					onclick={() => toggleReplyMode('forward')}
				>
					<Forward size={15} /><span class="rb-t">Forward</span>
				</button>
			{/if}
			<div class="grow"></div>
			{#if caps.showRestore}
				<button class="rb-ico" title="Restore" onclick={() => onRestore?.(m.id)}>
					<Undo2 size={17} />
				</button>
			{/if}
			{#if caps.showArchive}
				<button class="rb-ico" title="Archive" onclick={() => onArchive(m.id)}>
					<Archive size={17} />
				</button>
			{/if}
			{#if caps.showTrash}
				<button class="rb-ico" title="Delete" onclick={() => onTrash(m.id)}>
					<Trash2 size={17} />
				</button>
			{/if}
			{#if caps.showDelete}
				<button class="rb-ico rb-ico-danger" title="Permanently delete" onclick={() => onDelete?.(m.id)}>
					<Trash2 size={17} />
				</button>
			{/if}
			<div class="rb-more" bind:this={moreRef}>
				<button
					type="button"
					class="rb-ico"
					class:on={moreOpen}
					title="More"
					aria-haspopup="menu"
					aria-expanded={moreOpen}
					onclick={() => (moreOpen = !moreOpen)}
				>
					<Ellipsis size={17} />
				</button>
				{#if moreOpen}
					<AnchoredMenu anchor={moreRef} bind:panel={morePanel} extraClass="more-menu">
						{#if caps.showMarkRead && m.unread}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									onMarkRead?.(m.id);
									moreOpen = false;
								}}
							>
								<MailOpen size={17} />Mark as read
							</button>
						{:else if caps.showMarkRead}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									onMarkUnread?.(m.id);
									moreOpen = false;
								}}
							>
								<Mail size={17} />Mark as unread
							</button>
						{/if}
						{#if caps.showSnooze && onSnooze}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									moreOpen = false;
									snoozePickerOpen = true;
								}}
							>
								<Clock size={17} />Snooze
							</button>
						{/if}
						{#if caps.showUnsnooze && onUnsnooze}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									moreOpen = false;
									onUnsnooze?.(m.id);
								}}
							>
								<AlarmClockOff size={17} />Unsnooze
							</button>
						{/if}
						<div class="msep"></div>
						{#if caps.showMove}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									moreOpen = false;
									movePickerOpen = true;
								}}
							>
								<FolderInput size={17} />Move to folder
							</button>
						{/if}
						<button
							type="button"
							class="mitem"
							role="menuitem"
							onclick={() => {
								moreOpen = false;
								labelPickerOpen = true;
							}}
						>
							<Tag size={17} />Edit labels
						</button>
						<button
							type="button"
							class="mitem"
							role="menuitem"
							onclick={() => (moreOpen = false)}
						>
							<BellOff size={17} />Mute conversation
						</button>
						<div class="msep"></div>
						<button
							type="button"
							class="mitem"
							role="menuitem"
							onclick={() => {
								moreOpen = false;
								headersOpen = true;
							}}
						>
							<Code size={17} />View original headers
						</button>
						<button
							type="button"
							class="mitem"
							role="menuitem"
							onclick={() => {
								if (typeof window !== 'undefined') window.print();
								moreOpen = false;
							}}
						>
							<Printer size={17} />Print<span class="rt">⌘P</span>
						</button>
						{#if canBlock || canReport}
							<div class="msep"></div>
						{/if}
						{#if canBlock}
							<button
								type="button"
								class="mitem"
								role="menuitem"
								onclick={() => {
									moreOpen = false;
									blockOpen = true;
								}}
							>
								<UserX size={17} />Block sender
							</button>
						{/if}
						{#if canReport}
							<button
								type="button"
								class="mitem danger"
								role="menuitem"
								onclick={() => {
									moreOpen = false;
									reportOpen = true;
								}}
							>
								<ShieldAlert size={17} />Report phishing or spam
							</button>
						{/if}
					</AnchoredMenu>
				{/if}
				{#if labelPickerOpen && m}
					<AnchoredMenu
						anchor={moreRef}
						bind:panel={labelPickerRef}
						extraClass="label-picker"
						role="dialog"
						label="Edit labels"
					>
						<div class="menu-lbl">Labels</div>
						{#each labelOptions as [id, l] (id)}
							{@const on = currentLabels.includes(id)}
							<button
								type="button"
								class="mitem lp-row"
								class:on
								aria-pressed={on}
								disabled={labelSaving}
								onclick={() => void toggleLabel(id)}
							>
								<span class="lp-dot" style:background={l.color}></span>
								<span class="lp-name">{l.name}</span>
								{#if on}
									<span class="mck"><MailOpen size={14} /></span>
								{/if}
							</button>
						{/each}
						{#if labelError}
							<div class="lp-err" role="alert">{labelError}</div>
						{/if}
					</AnchoredMenu>
				{/if}
				{#if movePickerOpen && m}
					<AnchoredMenu
						anchor={moreRef}
						bind:panel={movePickerRef}
						extraClass="label-picker move-picker"
						role="dialog"
						label="Move to folder"
					>
						<div class="menu-lbl">Move to</div>
						{#each moveTargets as t (t.id)}
							{@const Icon = t.icon}
							<button type="button" class="mitem" onclick={() => moveTo(t.id)}>
								<Icon size={17} />{t.label}
							</button>
						{/each}
						<div class="msep"></div>
						<div class="menu-lbl">Label and archive</div>
						{#each labelOptions as [id, l] (id)}
							<button type="button" class="mitem lp-row" onclick={() => moveToLabel(id)}>
								<span class="lp-dot" style:background={l.color}></span>
								<span class="lp-name">{l.name}</span>
							</button>
						{/each}
					</AnchoredMenu>
				{/if}
				{#if snoozePickerOpen && m}
					<SnoozePicker
						anchor={moreRef}
						onPick={snoozeUntil}
						onClose={() => (snoozePickerOpen = false)}
					/>
				{/if}
			</div>
		</div>
		<div class="reader-scroll">
			{#key m.id}
			<div class="reader-inner">
				<div class="reader-h">
					<h1>
						{plainSubject(m.subj)}
						{#if caps.showStar}
							<button class="star-big" class:on={m.starred} onclick={() => onToggleStar(m.id)}>
								<Star size={20} />
							</button>
						{/if}
					</h1>
				</div>

				{#if snoozeState}
					<div class="snz-note" class:back={snoozeState.kind === 'returned'}>
						<Clock size={13} />
						<span>
							{snoozeState.kind === 'pending'
								? `Snoozed until ${formatWhenLong(snoozeState.at)}`
								: `Came back from snooze ${formatWhenLong(snoozeState.at).toLowerCase()}`}
						</span>
						{#if snoozeState.kind === 'pending' && onUnsnooze}
							<button type="button" class="snz-undo" onclick={() => onUnsnooze?.(m.id)}>
								Unsnooze
							</button>
						{/if}
					</div>
				{/if}

				{#if enriched?.thread && enriched.thread.length > 1}
					<Thread m={enriched} onConfirmKeyChange={confirmKeyChange} />
				{:else}
					<div class="letterhead">
						<Avatar
							initials={m.init}
							bg={m.bg}
							fg={m.fg}
							size={34}
							src={img.src}
							fit={img.fit}
							imgBg={img.imgBg}
						/>
						<div class="who">
							<div class="nm">{m.from}</div>
							<div class="det">
								<span class="em">{m.fromAddr}</span>
								<span class="to">&rarr; {m.to || '—'}</span>
							</div>
						</div>
						<div class="prov">
							<div class="when">{formatWhenLong(new Date(m.epoch))}</div>
							{#if readerTrust}
								<TrustMark
									trust={readerTrust}
									variant="chip"
									onConfirmKeyChange={() => confirmKeyChange(m.fromAddr)}
								/>
							{/if}
						</div>
					</div>

					<div class="email-sheet">
						<EmailBody srcDoc={bodySrcDoc} />
					</div>

					{#if isForwarded}
						<div class="fwd-chip"><CornerDownLeft size={13} />Forwarded message</div>
					{/if}

					{#if quotedSrcDoc}
						<div class="quoted-wrap">
							<button
								type="button"
								class="quoted-toggle"
								class:on={showQuoted}
								title={showQuoted ? 'Hide trimmed content' : 'Show trimmed content'}
								aria-expanded={showQuoted}
								onclick={() => (showQuoted = !showQuoted)}
							>
								<Ellipsis size={16} />
							</button>
							{#if showQuoted}
								<div class="quoted-email">
									<EmailBody srcDoc={quotedSrcDoc} />
								</div>
							{/if}
						</div>
					{/if}

					{#each calendarEvents as ev, i (ev.uid ?? i)}
						<EventCard {ev} message={enriched ?? m} />
					{/each}

					{#if !isThreadView}
						<AttachmentList chips={attachmentChips} refresh={refreshPointer} />
					{/if}
				{/if}

				{#if replyMode}
					{#key `${replyMode}:${m.id}`}
						<ReplyBox
							m={enriched ?? m}
							mode={replyMode}
							seed={replySeed}
							canArchive={caps.showArchive && !!onReplySentArchive}
							onSent={() => {
								threadRefreshTick += 1;
								replyMode = null;
								onReplySent?.();
							}}
							onSentAndArchive={() => {
								const id = m.id;
								replyMode = null;
								onReplySentArchive?.(id);
							}}
							onClose={() => (replyMode = null)}
						/>
					{/key}
				{/if}
			</div>
			{/key}
		</div>
	{/if}
</section>

{#if headersOpen && m}
	<OriginalHeadersDialog
		messageId={m.id}
		subject={plainSubject(m.subj)}
		onClose={() => (headersOpen = false)}
	/>
{/if}

{#if reportOpen && m}
	<ReportDialog
		messageId={m.id}
		subject={plainSubject(m.subj)}
		{senderAddress}
		onClose={() => (reportOpen = false)}
		onReported={(kind, outcome) => onReported?.(m.id, kind, outcome)}
	/>
{/if}

{#if blockOpen && m && senderAddress}
	<BlockSenderDialog
		address={senderAddress}
		displayName={m.from}
		existingCount={alsoInMailbox}
		onClose={() => (blockOpen = false)}
		onBlocked={(address, moveExisting) => onBlockedSender?.(address, moveExisting)}
	/>
{/if}
