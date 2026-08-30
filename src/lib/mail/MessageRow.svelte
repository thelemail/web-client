<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Star from '@lucide/svelte/icons/star';
	import Archive from '@lucide/svelte/icons/archive';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Mail from '@lucide/svelte/icons/mail';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Avatar from './Avatar.svelte';
	import {
		LABELS,
		plainSubject,
		formatRowTime,
		formatWhenLong,
		type Message
	} from './data';
	import type { MailActionCaps } from './actions';
	import { senderImage } from './senderImage';

	interface Props {
		m: Message;
		active: boolean;
		checked: boolean;
		anyChecked: boolean;
		caps: MailActionCaps;
		onOpen: (m: Message) => void;
		onToggleStar: (id: string) => void;
		onToggleCheck: (id: string) => void;
		onArchive: (id: string) => void;
		onTrash: (id: string) => void;
		onRestore?: (id: string) => void;
		onDelete?: (id: string) => void;
		onToggleRead: (id: string) => void;
	}

	let {
		m,
		active,
		checked,
		anyChecked,
		caps,
		onOpen,
		onToggleStar,
		onToggleCheck,
		onArchive,
		onTrash,
		onRestore,
		onDelete,
		onToggleRead
	}: Props = $props();

	const img = $derived(senderImage(m.fromAddr, m.bimiDomain));

	const labelChips = $derived(
		(m.labels ?? []).slice(0, 2).map((id) => ({ id, label: LABELS[id] })).filter((x) => !!x.label)
	);
	const labelOverflow = $derived(Math.max(0, (m.labels ?? []).length - labelChips.length));
	const threadCount = $derived(m.threadCount ?? m.thread?.length ?? 0);
	const hasEvent = $derived(!!m.event);
	const nonIcsAttachments = $derived(
		(m.attachments ?? []).filter((a) => !/\.ics$/i.test(a.name))
	);
	const showMeta = $derived(
		labelChips.length > 0 || hasEvent || nonIcsAttachments.length > 0
	);
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
	onclick={() => onOpen(m)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpen(m);
		}
	}}
	role="button"
	tabindex="0"
>
	<div
		class="lead"
		role="button"
		tabindex="-1"
		aria-label="Select message"
		onclick={(e) => {
			e.stopPropagation();
			onToggleCheck(m.id);
		}}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				onToggleCheck(m.id);
			}
		}}
	>
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
			class="row-ck"
			class:on={checked}
			onclick={(e) => {
				e.stopPropagation();
				onToggleCheck(m.id);
			}}
		>
			<Check size={13} />
		</button>
	</div>
	<div class="rowmain">
		<div class="r1">
			<span class="from">{m.from}</span>
			{#if threadCount > 1}
				<span class="thr-ct" title="{threadCount} messages">
					<MessagesSquare size={11} />{threadCount}
				</span>
			{/if}
			{#if hasEvent}
				<span class="tick" title="Invitation"><Calendar size={12} /></span>
			{/if}
			{#if nonIcsAttachments.length > 0}
				<span class="tick" title="{nonIcsAttachments.length} attached">
					<Paperclip size={12} />{nonIcsAttachments.length}
				</span>
			{/if}
			{#each labelChips as { id, label } (id)}
				<span class="lbl" title={label.name} style:background={label.color}></span>
			{/each}
			{#if labelOverflow > 0}
				<span class="lbl-more" title="{labelOverflow} more">+{labelOverflow}</span>
			{/if}
			{#if wakeAt}
				<span class="time wake" title="Comes back {formatWhenLong(wakeAt)}">
					{formatRowTime(wakeAt)}
				</span>
			{:else}
				<span class="time">{formatRowTime(new Date(m.epoch))}</span>
			{/if}
			{#if caps.showStar}
				<button
					class="star"
					class:on={m.starred}
					title={m.starred ? 'Unstar' : 'Star'}
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
			<span class="stxt">{plainSubject(m.subj)}</span>
			<span class="prev">{m.prev}</span>
		</div>
	</div>
	<div class="qa">
		{#if caps.showStar}
			<button
				class="star"
				class:on={m.starred}
				title="Star"
				onclick={(e) => {
					e.stopPropagation();
					onToggleStar(m.id);
				}}><Star size={15} /></button
			>
		{/if}
		{#if caps.showMarkRead}
			<button
				title={m.unread ? 'Mark as read' : 'Mark as unread'}
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
				title="Restore"
				onclick={(e) => {
					e.stopPropagation();
					onRestore?.(m.id);
				}}><Undo2 size={15} /></button
			>
		{/if}
		{#if caps.showArchive}
			<button
				title="Archive"
				onclick={(e) => {
					e.stopPropagation();
					onArchive(m.id);
				}}><Archive size={15} /></button
			>
		{/if}
		{#if caps.showTrash}
			<button
				title="Move to trash"
				onclick={(e) => {
					e.stopPropagation();
					onTrash(m.id);
				}}><Trash2 size={15} /></button
			>
		{/if}
		{#if caps.showDelete}
			<button
				title="Permanently delete"
				onclick={(e) => {
					e.stopPropagation();
					onDelete?.(m.id);
				}}><Trash2 size={15} /></button
			>
		{/if}
	</div>
</div>
