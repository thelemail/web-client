<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import Check from '@lucide/svelte/icons/check';
	import Star from '@lucide/svelte/icons/star';
	import Archive from '@lucide/svelte/icons/archive';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Mail from '@lucide/svelte/icons/mail';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Avatar from '$core/components/Avatar.svelte';
	import {
		plainSubject,
		formatRowTime,
		formatWhenLong,
		type Message
	} from './data';
	import type { MailActionCaps } from './actions';
	import { senderImage } from './senderImage';
	import { sentByName } from './sentBy';
	import { auth } from '$core/stores/auth.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import LabelChip from './collections/LabelChip.svelte';
	import LocationChip from './collections/LocationChip.svelte';
	import { customLabelId } from './folderRoute';
	import { locationFor } from './location';
	import type { CollectionEntry } from './collections/tree';

	interface Props {
		m: Message;
		active: boolean;
		checked: boolean;
		anyChecked: boolean;
		caps: MailActionCaps;
		viewFolder: string;
		searching?: boolean;
		onOpen: (m: Message) => void;
		onSelect?: (id: string, range: boolean) => void;
		onToggleStar: (id: string) => void;
		onToggleCheck: (id: string) => void;
		onArchive: (id: string) => void;
		onTrash: (id: string) => void;
		onRestore?: (id: string) => void;
		onDelete?: (id: string) => void;
		onSpam?: (id: string) => void;
		onToggleRead: (id: string) => void;
	}

	let {
		m,
		active,
		checked,
		anyChecked,
		caps,
		viewFolder,
		searching = false,
		onOpen,
		onSelect,
		onToggleStar,
		onToggleCheck,
		onArchive,
		onTrash,
		onRestore,
		onDelete,
		onSpam,
		onToggleRead
	}: Props = $props();

	const uid = $props.id();
	const img = $derived(senderImage(m.fromAddr, m.bimiDomain));
	const rowState = $derived(
		[m.unread ? msg.mail_row_unread() : '', m.starred ? msg.mail_row_starred() : '']
			.filter(Boolean)
			.join(', ')
	);
	const byName = $derived(m.sentBy ? sentByName(m.sentBy, auth.accountId) : null);

	const CHIP_LIMIT = 2;
	const threadCount = $derived(m.threadCount ?? m.thread?.length ?? 0);
	const viewLabelId = $derived(customLabelId(viewFolder));
	const labelChips = $derived.by(() => {
		const counts = m.labelCounts;
		const ids = counts ? Object.keys(counts) : (m.labels ?? []);
		const total = Math.max(1, threadCount);
		return ids
			.filter((id) => id !== viewLabelId)
			.map((id) => ({ entry: mailCollections.label(id), partial: !!counts && counts[id] < total }))
			.filter((c): c is { entry: CollectionEntry; partial: boolean } => !!c.entry && !c.entry.sealed)
			.sort((a, b) => a.entry.path.localeCompare(b.entry.path));
	});
	const shownChips = $derived(labelChips.slice(0, CHIP_LIMIT));
	const hiddenChips = $derived(labelChips.slice(CHIP_LIMIT));
	const location = $derived(locationFor(m.folder, viewFolder, searching));
	const hasEvent = $derived(!!m.event);
	const nonIcsAttachments = $derived(
		(m.attachments ?? []).filter((a) => !/\.ics$/i.test(a.name))
	);
	function select(range: boolean) {
		if (onSelect) onSelect(m.id, range);
		else onToggleCheck(m.id);
	}

	const wakeAt = $derived.by<Date | null>(() => {
		if (m.folder !== 'snoozed' || !m.snoozedUntil) return null;
		const t = Date.parse(m.snoozedUntil);
		return Number.isFinite(t) ? new Date(t) : null;
	});
</script>

<div
	class="mrow"
	class:unread={m.unread}
	class:active
	class:sel={checked}
	class:checking={anyChecked}
>
	<button
		type="button"
		class="mrow-open"
		aria-current={active ? 'true' : undefined}
		aria-labelledby="{uid}-st {uid}-from {uid}-subj"
		aria-describedby="{uid}-time {uid}-prev"
		onclick={() => onOpen(m)}
	></button>
	<div class="lead">
		<Avatar
			initials={m.init}
			bg={m.bg}
			fg={m.fg}
			class="seal"
			size={22}
			src={img.src}
			fit={img.fit}
			imgBg={img.imgBg}
		/>
		<button
			type="button"
			class="row-ck"
			class:on={checked}
			aria-label={msg.mail_row_select()}
			aria-pressed={checked}
			onclick={(e) => {
				e.stopPropagation();
				select(e.shiftKey);
			}}
		>
			<Check size={13} />
		</button>
	</div>
	<div class="rowmain">
		<div class="r1">
			<span class="sr-only" id="{uid}-st">{rowState}</span>
			<span class="from" id="{uid}-from">{m.from}</span>
			{#if byName}
				<span class="by">{msg.mail_sent_by({ name: byName })}</span>
			{/if}
			{#if threadCount > 1}
				<span class="thr-ct" title={msg.mail_row_thread_count({ count: threadCount })}>
					<MessagesSquare size={11} />{threadCount}
				</span>
			{/if}
			{#if hasEvent}
				<span class="tick" title={msg.mail_row_invitation()}><Calendar size={12} /></span>
			{/if}
			{#if nonIcsAttachments.length > 0}
				<span class="tick" title={msg.mail_row_attached_count({ count: nonIcsAttachments.length })}>
					<Paperclip size={12} />{nonIcsAttachments.length}
				</span>
			{/if}
			{#if wakeAt}
				<span class="time wake" id="{uid}-time" title={msg.mail_row_comes_back({ when: formatWhenLong(wakeAt) })}>
					{formatRowTime(wakeAt)}
				</span>
			{:else}
				<span class="time" id="{uid}-time">{formatRowTime(new Date(m.epoch))}</span>
			{/if}
			{#if caps.showStar}
				<button
					type="button"
					class="star"
					class:on={m.starred}
					tabindex="-1"
					aria-hidden="true"
					title={m.starred ? msg.mail_action_unstar() : msg.mail_action_star()}
					onclick={(e) => {
						e.stopPropagation();
						onToggleStar(m.id);
					}}
				>
					<Star size={13} />
				</button>
			{/if}
		</div>
		<div class="r2">
			{#if location || shownChips.length > 0}
				<span class="row-chips">
					{#if location}
						<LocationChip {location} />
					{/if}
					{#each shownChips as chip (chip.entry.id)}
						<LabelChip
							name={chip.entry.name}
							path={chip.entry.path}
							color={chip.entry.color}
							partial={chip.partial}
						/>
					{/each}
					{#if hiddenChips.length > 0}
						<span
							class="lchip-more"
							title={hiddenChips.map((c) => c.entry.path).join(', ')}
						>
							<span aria-hidden="true">+{hiddenChips.length}</span>
							<span class="sr-only">
								{msg.mail_row_labels_more_named({
									labels: hiddenChips.map((c) => c.entry.path).join(', ')
								})}
							</span>
						</span>
					{/if}
				</span>
			{/if}
			<span class="stxt" id="{uid}-subj">{plainSubject(m.subj)}</span>
			<span class="prev" id="{uid}-prev">{m.prev}</span>
		</div>
	</div>
	<div class="qa">
		{#if caps.showStar}
			<button
				type="button"
				class="star"
				class:on={m.starred}
				aria-pressed={m.starred}
				title={m.starred ? msg.mail_action_unstar() : msg.mail_action_star()}
				onclick={(e) => {
					e.stopPropagation();
					onToggleStar(m.id);
				}}><Star size={15} /></button
			>
		{/if}
		{#if caps.showMarkRead}
			<button
				title={m.unread ? msg.mail_action_mark_read() : msg.mail_action_mark_unread()}
				onclick={(e) => {
					e.stopPropagation();
					onToggleRead(m.id);
				}}
			>
				{#if m.unread}
					<MailOpen size={15} />
				{:else}
					<Mail size={15} />
				{/if}
			</button>
		{/if}
		{#if caps.showRestore}
			<button
				data-mutates
				title={msg.mail_action_restore()}
				onclick={(e) => {
					e.stopPropagation();
					onRestore?.(m.id);
				}}><Undo2 size={15} /></button
			>
		{/if}
		{#if caps.showArchive}
			<button
				data-mutates
				title={msg.mail_action_archive()}
				onclick={(e) => {
					e.stopPropagation();
					onArchive(m.id);
				}}><Archive size={15} /></button
			>
		{/if}
		{#if caps.showSpam && onSpam}
			<button
				title={msg.mail_action_report_spam()}
				onclick={(e) => {
					e.stopPropagation();
					onSpam?.(m.id);
				}}><ShieldAlert size={15} /></button
			>
		{/if}
		{#if caps.showTrash}
			<button
				data-mutates
				title={msg.mail_action_trash()}
				onclick={(e) => {
					e.stopPropagation();
					onTrash(m.id);
				}}><Trash2 size={15} /></button
			>
		{/if}
		{#if caps.showDelete}
			<button
				data-mutates
				title={msg.mail_action_delete_forever()}
				onclick={(e) => {
					e.stopPropagation();
					onDelete?.(m.id);
				}}><Trash2 size={15} /></button
			>
		{/if}
	</div>
</div>
