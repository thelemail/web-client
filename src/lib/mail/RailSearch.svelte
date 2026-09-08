<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { mailSearch } from '$lib/stores/search.svelte';

	const OPERATORS = ['from:', 'is:unread', 'is:starred', 'has:attachment', 'in:folder'];

	let inputRef: HTMLInputElement | undefined = $state();
	let focused = $state(false);

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

	function apply(op: string) {
		const next = mailSearch.text.trim();
		mailSearch.setText(next ? `${next} ${op}` : op);
		inputRef?.focus();
	}
</script>

<svelte:document onkeydown={handleKey} />

{#if inMail}
	<div class="searchwrap">
		<div class="search">
			<Search size={16} />
			<input
				bind:this={inputRef}
				value={mailSearch.text}
				oninput={(e) => mailSearch.setText((e.currentTarget as HTMLInputElement).value)}
				onfocus={() => (focused = true)}
				onblur={() => (focused = false)}
				placeholder="Search mail"
			/>
			{#if mailSearch.text}
				<button class="clr" onclick={() => mailSearch.clear()} title="Clear"
					><X size={14} /></button
				>
			{:else}
				<span class="kbd">/</span>
			{/if}
		</div>
		{#if focused}
			<div class="srch-ops">
				{#each OPERATORS as op (op)}
					<button type="button" class="srch-op" onmousedown={(e) => e.preventDefault()} onclick={() => apply(op)}>
						{op}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
