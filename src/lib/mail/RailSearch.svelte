<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { mailSearch } from '$lib/stores/mailSearch.svelte';

	let inputRef: HTMLInputElement | undefined = $state();

	const inMail = $derived(/\/u\/\d+\/mail(\/|$)/.test(page.url.pathname));

	function handleKey(e: KeyboardEvent) {
		const el = document.activeElement;
		const typing =
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			(el instanceof HTMLElement && el.isContentEditable);
		if (!inMail) return;
		if (e.key === '/' && !typing) {
			e.preventDefault();
			inputRef?.focus();
		}
	}
</script>

<svelte:document onkeydown={handleKey} />

{#if inMail}
	<div class="search">
		<Search size={16} />
		<input
			bind:this={inputRef}
			value={mailSearch.text}
			oninput={(e) => (mailSearch.text = (e.currentTarget as HTMLInputElement).value)}
			placeholder="Search mail"
		/>
		{#if mailSearch.text}
			<button class="clr" onclick={() => mailSearch.clear()} title="Clear"><X size={14} /></button>
		{:else}
			<span class="kbd">/</span>
		{/if}
	</div>
{/if}
