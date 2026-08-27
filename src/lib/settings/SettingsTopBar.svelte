<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { mailNav } from '$lib/stores/nav.svelte';

	interface Props {
		query: string;
		setQuery: (q: string) => void;
	}

	let { query, setQuery }: Props = $props();

	let inputRef: HTMLInputElement | undefined = $state();

	function handleKey(e: KeyboardEvent) {
		const el = document.activeElement;
		const typing =
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			(el instanceof HTMLElement && el.isContentEditable);
		if (e.key === '/' && !typing) {
			e.preventDefault();
			inputRef?.focus();
		}
	}

	async function backToMail() {
		const slot = page.params.slot ?? '0';
		await goto(`/u/${slot}/mail/inbox`);
	}
</script>

<svelte:document onkeydown={handleKey} />

<header class="settings-h">
	<button class="lh-nav" title="Menu" onclick={() => (mailNav.open = !mailNav.open)}>
		<Menu size={18} />
	</button>
	<span class="settings-t">Settings</span>
	<div class="grow"></div>
	<div class="search settings-search">
		<Search size={16} />
		<input
			bind:this={inputRef}
			value={query}
			oninput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
			placeholder="Search settings"
		/>
		{#if query}
			<button class="clr" onclick={() => setQuery('')} title="Clear"><X size={14} /></button>
		{:else}
			<span class="kbd">/</span>
		{/if}
	</div>
	<button class="lh-btn" title="Back to mail" onclick={backToMail}>
		<ArrowLeft size={17} />
	</button>
</header>
