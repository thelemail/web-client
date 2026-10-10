<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { mailSearch } from '$core/stores/search.svelte';

	interface Props {
		placeholder?: string;
		operators?: boolean;
	}

	let { placeholder = m.mail_search_placeholder(), operators = true }: Props = $props();

	const OPERATORS = ['from:', 'is:unread', 'is:starred', 'has:attachment', 'in:', 'label:'];

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

	function handleInputKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		mailSearch.clear();
		inputRef?.blur();
	}

	function apply(op: string) {
		const next = mailSearch.text.trim();
		mailSearch.setText(next ? `${next} ${op}` : op);
		inputRef?.focus();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div class="searchwrap">
	<div class="search">
		<Search size={16} />
		<input
			bind:this={inputRef}
			value={mailSearch.text}
			oninput={(e) => mailSearch.setText((e.currentTarget as HTMLInputElement).value)}
			onkeydown={handleInputKey}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			{placeholder}
			aria-label={placeholder}
		/>
		{#if mailSearch.text}
			<button class="clr" onclick={() => mailSearch.clear()} title={m.mail_search_clear()}
				><X size={14} /></button
			>
		{:else}
			<span class="kbd">/</span>
		{/if}
	</div>
	{#if focused && operators}
		<div class="srch-ops">
			{#each OPERATORS as op (op)}
				<button type="button" class="srch-op" onmousedown={(e) => e.preventDefault()} onclick={() => apply(op)}>
					{op}
				</button>
			{/each}
		</div>
	{/if}
</div>
