<script lang="ts">
	import './lifecycle.css';
	import type { Snippet } from 'svelte';
	import AuthShell from '$lib/auth/AuthShell.svelte';
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

<AuthShell>
	{#if badge}
		<span class="lc-state-badge{sevClass}"><span class="d"></span>{badge.label}</span>
	{/if}
	{@render children()}
	{#if backHref}
		<a class="lc-back" href={backHref}><ArrowLeft size={16} />Back to mailbox</a>
	{/if}
</AuthShell>
