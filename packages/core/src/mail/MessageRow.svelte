<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRotateLeft,
		faBoxArchive,
		faCalendar,
		faEnvelope,
		faEnvelopeOpen,
		faMessages,
		faPaperclip,
		faShieldExclamation,
		faStar,
		faTrashCan
	} from '@fortawesome/pro-regular-svg-icons';
	import { faStar as faStarSolid } from '@fortawesome/pro-solid-svg-icons';
	import StateIcon from '$core/components/StateIcon.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import type { Snippet } from 'svelte';
	import { swipe, swipeThreshold, type SwipeDirection } from '$core/actions/swipe';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
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
	import Marked from './Marked.svelte';
	import { customLabelId } from './folderRoute';
	import { locationFor } from './location';
	import type { CollectionEntry } from './collections/tree';

	interface Props {
		m: Message;
		active: boolean;
		fresh?: boolean;
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
		fresh = false,
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
	let rowEl: HTMLDivElement | undefined = $state();
	let droppedFocusAt = -Infinity;
	let neighbours: HTMLElement[] = [];

	function rowsAround(el: HTMLElement): HTMLElement[] {
		const rows = [...(el.parentElement?.querySelectorAll<HTMLElement>('.mrow') ?? [])];
		const i = rows.indexOf(el);
		return i < 0 ? [] : [...rows.slice(i + 1), ...rows.slice(0, i).reverse()];
	}

	function onFocusOut(e: FocusEvent) {
		if (e.relatedTarget || !rowEl) return;
		droppedFocusAt = performance.now();
		neighbours = rowsAround(rowEl);
	}

	$effect(() => {
		const el = rowEl;
		return () => {
			if (!el) return;
			const active = document.activeElement;
			const held = el.contains(active);
			const dropped = (!active || active === document.body) && performance.now() - droppedFocusAt < 10000;
			if (!held && !dropped) return;
			const candidates = held && el.isConnected ? rowsAround(el) : neighbours;
			queueMicrotask(() => {
				const next = candidates.find((r) => r.isConnected);
				next?.querySelector<HTMLElement>('.mrow-open')?.focus();
			});
		};
	});

	let sx = $state(0);
	let settling = $state(false);
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	const leftAction = $derived(
		lifecycle.readOnly ? null : caps.showArchive ? 'archive' : caps.showTrash ? 'trash' : null
	);
	const rightAction = $derived(caps.showMarkRead ? 'read' : null);
	const armed = $derived(rowEl ? Math.abs(sx) >= swipeThreshold(rowEl.clientWidth) : false);

	function settle(to: number, then?: () => void) {
		clearTimeout(settleTimer);
		settling = true;
		sx = to;
		settleTimer = setTimeout(() => {
			settling = false;
			then?.();
		}, 180);
	}

	function commitSwipe(dir: SwipeDirection) {
		if (dir === 'right') {
			onToggleRead(m.id);
			settle(0);
			return;
		}
		const action = leftAction;
		settle(-(rowEl?.clientWidth ?? 0), () => {
			if (action === 'archive') onArchive(m.id);
			else if (action === 'trash') onTrash(m.id);
			settle(0);
		});
	}

	$effect(() => () => clearTimeout(settleTimer));

	const img = $derived(senderImage(m.fromAddr, m.bimiDomain, m.senderMismatch));
	const rowState = $derived(
		[
			m.senderMismatch ? msg.mail_row_sender_mismatch() : '',
			m.unread ? msg.mail_row_unread() : '',
			m.starred ? msg.mail_row_starred() : ''
		]
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
	const hit = $derived(m.match ?? null);
	function attachmentPlace(name: string, place: string | null): string {
		const page = place?.match(/^page:(\d+)$/);
		if (page) return msg.mail_search_in_attachment_page({ name, page: page[1] });
		const slide = place?.match(/^(?:slide|notes|comments):(\d+)$/);
		if (slide) return msg.mail_search_in_attachment_slide({ name, slide: slide[1] });
		const sheet = place?.match(/^(?:sheet:(.+)|(.+)!.+)$/);
		if (sheet) return msg.mail_search_in_attachment_sheet({ name, sheet: sheet[1] ?? sheet[2] });
		return msg.mail_search_in_attachment({ name });
	}

	const matchedIn = $derived.by(() => {
		if (!hit) return null;
		if (hit.filename) return attachmentPlace(hit.filename, hit.place);
		if (hit.quoted) return msg.mail_search_in_quoted();
		return null;
	});
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
	bind:this={rowEl}
	class="mrow"
	data-id={m.id}
	onfocusout={onFocusOut}
	class:unread={m.unread}
	class:active
	class:fresh
	class:sel={checked}
	class:checking={anyChecked}
	class:swiping={sx !== 0}
	class:settling
	style:--sx={sx ? `${sx}px` : undefined}
	use:swipe={{
		enabled: !anyChecked,
		left: !!leftAction,
		right: !!rightAction,
		onDrag: (dx) => {
			clearTimeout(settleTimer);
			settling = false;
			sx = dx;
		},
		onCommit: commitSwipe,
		onCancel: () => settle(0)
	}}
>
	{#if sx !== 0}
		<div
			class="swipe-under"
			class:to-left={sx < 0}
			class:to-right={sx > 0}
			class:trash={sx < 0 && leftAction === 'trash'}
			class:armed
			style:width="{Math.abs(sx)}px"
			aria-hidden="true"
		>
			{#if sx < 0}
				{#if leftAction === 'trash'}<Icon icon={faTrashCan} size={18} />{:else}<Icon icon={faBoxArchive} size={18} />{/if}
			{:else if m.unread}
				<Icon icon={faEnvelopeOpen} size={18} />
			{:else}
				<Icon icon={faEnvelope} size={18} />
			{/if}
		</div>
	{/if}
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
			class="check row-ck"
			data-state={checked ? 'checked' : 'unchecked'}
			aria-label={msg.mail_row_select()}
			aria-pressed={checked}
			onclick={(e) => {
				e.stopPropagation();
				select(e.shiftKey);
			}}
		></button>
	</div>
	<div class="rowmain">
		<div class="r1">
			<span class="sr-only" id="{uid}-st">{rowState}</span>
			<span class="from" id="{uid}-from">{m.from}</span>
			{#if m.senderMismatch}
				<span class="tick forged" title={msg.mail_row_sender_mismatch()}><Icon icon={faShieldExclamation} size={12} /></span>
			{/if}
			{#if byName}
				<span class="by">{msg.mail_sent_by({ name: byName })}</span>
			{/if}
			{#if threadCount > 1}
				<span class="thr-ct" title={msg.mail_row_thread_count({ count: threadCount })}>
					<Icon icon={faMessages} size={11} />{threadCount}
				</span>
			{/if}
			{#if hasEvent}
				<span class="tick" title={msg.mail_row_invitation()}><Icon icon={faCalendar} size={12} /></span>
			{/if}
			{#if nonIcsAttachments.length > 0}
				<span class="tick" title={msg.mail_row_attached_count({ count: nonIcsAttachments.length })}>
					<Icon icon={faPaperclip} size={12} />{nonIcsAttachments.length}
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
					<StateIcon icon={faStar} activeIcon={faStarSolid} active={m.starred} gesture="spin" size={13} />
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
			{#if hit && hit.kind !== 'message'}
				<span class="kind-chip">{hit.kind === 'draft' ? msg.mail_search_kind_draft() : msg.mail_search_kind_scheduled()}</span>
			{/if}
			{#if hit}
				<span class="stxt" id="{uid}-subj" dir="auto"><Marked text={m.subj} spans={hit.subjectSpans} /></span>
				{#if hit.matches > 1}
					<span class="hit-ct">{msg.mail_search_row_matches({ count: hit.matches, shown: new Intl.NumberFormat().format(hit.matches) })}</span>
				{/if}
				<span class="prev" id="{uid}-prev" dir="auto">
					{#if matchedIn}<span class="hit-in">{matchedIn}</span>{/if}
					{#if hit.excerpt !== null}<Marked text={hit.excerpt} spans={hit.excerptSpans} lead={hit.clippedStart} trail={hit.clippedEnd} />{/if}
				</span>
			{:else}
				<span class="stxt" id="{uid}-subj">{plainSubject(m.subj)}</span>
				<span class="prev" id="{uid}-prev">{m.prev}</span>
			{/if}
		</div>
	</div>
	<div class="qa">
		{#if caps.showStar}
			{@render qaButton(m.starred ? msg.mail_action_unstar() : msg.mail_action_star(), () => onToggleStar(m.id), star, {
				pressed: m.starred,
				star: true
			})}
		{/if}
		{#if caps.showMarkRead}
			{@render qaButton(
				m.unread ? msg.mail_action_mark_read() : msg.mail_action_mark_unread(),
				() => onToggleRead(m.id),
				m.unread ? mailOpen : mail
			)}
		{/if}
		{#if caps.showRestore}
			{@render qaButton(msg.mail_action_restore(), () => onRestore?.(m.id), undo, { mutates: true })}
		{/if}
		{#if caps.showArchive}
			{@render qaButton(msg.mail_action_archive(), () => onArchive(m.id), archive, { mutates: true })}
		{/if}
		{#if caps.showSpam && onSpam}
			{@render qaButton(msg.mail_action_report_spam(), () => onSpam?.(m.id), spam)}
		{/if}
		{#if caps.showTrash}
			{@render qaButton(msg.mail_action_trash(), () => onTrash(m.id), trash, { mutates: true, danger: true })}
		{/if}
		{#if caps.showDelete}
			{@render qaButton(msg.mail_action_delete_forever(), () => onDelete?.(m.id), trash, { mutates: true, danger: true })}
		{/if}
	</div>
</div>

{#snippet qaButton(
	label: string,
	run: () => void,
	icon: Snippet,
	opts: { pressed?: boolean; mutates?: boolean; danger?: boolean; star?: boolean } = {}
)}
	<Button
		variant={opts.danger ? 'ghostDanger' : 'ghost'}
		size="icon-sm"
		class={opts.star ? 'btn-star' : undefined}
		tooltip={label}
		aria-pressed={opts.pressed}
		data-mutates={opts.mutates ? '' : undefined}
		onclick={(e: MouseEvent) => {
			e.stopPropagation();
			run();
		}}
	>
		{@render icon()}
	</Button>
{/snippet}

{#snippet star()}<StateIcon icon={faStar} activeIcon={faStarSolid} active={m.starred} gesture="spin" size={15} />{/snippet}
{#snippet mailOpen()}<Icon icon={faEnvelopeOpen} size={15} />{/snippet}
{#snippet mail()}<Icon icon={faEnvelope} size={15} />{/snippet}
{#snippet undo()}<Icon icon={faArrowRotateLeft} size={15} />{/snippet}
{#snippet archive()}<Icon icon={faBoxArchive} size={15} />{/snippet}
{#snippet spam()}<Icon icon={faShieldExclamation} size={15} />{/snippet}
{#snippet trash()}<Icon icon={faTrashCan} size={15} />{/snippet}
