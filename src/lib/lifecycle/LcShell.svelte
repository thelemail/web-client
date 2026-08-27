<script lang="ts">
	import '$lib/auth/auth.css';
	import './lifecycle.css';
	import type { Snippet } from 'svelte';
	import wordmark from '$lib/assets/logo-wordmark.svg';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	let {
		badge,
		backHref,
		children
	}: {
		badge?: { label: string; sev?: '' | 'warn' | 'danger' };
		backHref?: string;
		children: Snippet;
	} = $props();

	const sevClass = $derived(badge?.sev === 'warn' ? ' sev-warn' : badge?.sev === 'danger' ? ' sev-danger' : '');
</script>

<div class="auth" data-motif="ledger">
	<header class="topchrome">
		<a href="/"><img class="wm" src={wordmark} alt="Thelemail" /></a>
		<span class="grow"></span>
		{#if badge}
			<span class="lc-state-badge{sevClass}"><span class="d"></span>{badge.label}</span>
		{/if}
		{#if backHref}
			<a class="ghostlink" href={backHref}><ArrowLeft size={16} />Back to mailbox</a>
		{/if}
	</header>
	<div class="stagebody">{@render children()}</div>
</div>
