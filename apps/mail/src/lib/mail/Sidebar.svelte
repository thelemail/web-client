<script lang="ts">
	import { page } from '$app/state';
	import {
		AlarmClock,
		Archive,
		ArchiveRestore,
		ChevronDown,
		ChevronUp,
		Clock,
		FilePen,
		FileText,
		Folder,
		Mail,
		MailOpen,
		Send,
		SendHorizontal,
		ShieldAlert,
		ShieldX,
		Star,
		Timer,
		Trash,
		Trash2,
		type IconNode
	} from 'lucide';
	import NavMorph from '$lib/components/NavMorph.svelte';
	import RailSearch from './RailSearch.svelte';
	import RailAccount from './RailAccount.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import { FOLDERS } from './data';
	import { billing } from '$lib/stores/billing.svelte';
	import { mailNav } from '$lib/stores/nav.svelte';

	function closeNav() {
		mailNav.open = false;
	}

	interface Counts {
		inbox: number;
		starred: number;
		drafts: number;
		spam: number;
		snoozed: number;
		scheduled: number;
		[k: string]: number | undefined;
	}

	interface Props {
		counts: Counts;
		onCompose: () => void;
	}

	let { counts, onCompose }: Props = $props();
	let showMore = $state(false);

	const slot = $derived(page.params.slot ?? '0');
	const slotBase = $derived(`/u/${slot}`);

	const folderIcons: Record<string, [IconNode, IconNode]> = {
		inbox: [Mail, MailOpen],
		starred: [Star, Star],
		sent: [Send, SendHorizontal],
		drafts: [FileText, FilePen],
		archive: [Archive, ArchiveRestore],
		snoozed: [Clock, AlarmClock],
		scheduled: [SendHorizontal, Timer],
		spam: [ShieldAlert, ShieldX],
		trash: [Trash2, Trash]
	};

	const FALLBACK_ICONS: [IconNode, IconNode] = [Folder, Folder];

	const primary = $derived(FOLDERS.filter((f) => !f.more));
	const secondary = $derived(FOLDERS.filter((f) => f.more));

	const activeSystemFolder = $derived(page.params.folder ?? null);

	const storageUsed = $derived(billing.subscription?.storageBytesUsed ?? 0);
	const storageLimit = $derived(billing.subscription?.storageBytesLimit ?? 0);
	const storagePct = $derived(storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0);

	function fmtStorage(bytes: number): string {
		if (bytes <= 0) return '0 MB';
		const gib = bytes / 2 ** 30;
		if (gib < 1) return `${Math.max(1, Math.round(bytes / 2 ** 20))} MB`;
		return `${gib.toFixed(1).replace(/\.0$/, '')} GB`;
	}
</script>

<aside class="rail">
	<a class="brand" href="/" aria-label="Thelemail"><span class="wm">Thelemail</span></a>

	<button class="compose" onclick={onCompose}>
		<PenLine size={17} />Compose
	</button>

	<RailSearch />

	<div class="rail-scroll">
		<div class="fgroup">Mailbox</div>
		<div class="nav-list">
			{#each primary as f (f.id)}
				{@const pair = folderIcons[f.id] ?? FALLBACK_ICONS}
				{@const on = activeSystemFolder === f.id}
				{@const c = counts[f.id]}
				{@const isInbox = f.id === 'inbox'}
				<a
					class="fld"
					class:active={on}
					class:solid={f.id === 'starred'}
					class:unread={isInbox && c}
					href={`${slotBase}/mail/${f.id}`}
					onclick={closeNav}
				>
					<NavMorph icon={on ? pair[1] : pair[0]} />
					<span class="lbl">{f.label}</span>
					{#if c}<span class="ct">{c}</span>{/if}
				</a>
			{/each}
			{#if showMore}
				{#each secondary as f (f.id)}
					{@const pair = folderIcons[f.id] ?? FALLBACK_ICONS}
					{@const on = activeSystemFolder === f.id}
					{@const c = counts[f.id]}
					<a class="fld" class:active={on} href={`${slotBase}/mail/${f.id}`} onclick={closeNav}>
						<NavMorph icon={on ? pair[1] : pair[0]} />
						<span class="lbl">{f.label}</span>
						{#if c}<span class="ct">{c}</span>{/if}
					</a>
				{/each}
			{/if}
			<button
				type="button"
				class="fld more-toggle"
				onclick={() => (showMore = !showMore)}
			>
				<NavMorph icon={showMore ? ChevronUp : ChevronDown} />
				<span class="lbl">{showMore ? 'Less' : 'More'}</span>
			</button>
		</div>
	</div>

	{#if storageLimit > 0}
		<div class="storage">
			<div class="srow"><span>STORAGE</span><span><b>{fmtStorage(storageUsed)}</b> / {fmtStorage(storageLimit)}</span></div>
			<div class="meter"><i style:width={`${storagePct}%`}></i></div>
		</div>
	{/if}

	<RailAccount />
</aside>
