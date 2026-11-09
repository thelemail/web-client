<script lang="ts">
	import { onMount } from 'svelte';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { appOrigin } from '$core/products';
	import { m } from '$paraglide/messages.js';
	import { startFor } from './fallback';

	const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
	history.replaceState(null, '', window.location.pathname);
	let error = $state<string | null>(null);

	onMount(() => {
		const account = params.get('account');
		void startFor(account && /^[0-9a-f-]{36}$/.test(account) ? account : null, params.get('route') ?? '/').catch(() => {
			error = m.handoff_failed();
		});
	});
</script>

<AuthShell>
	<div class="card handoffcard" aria-live="polite">
		{#if error}
			<h1>{m.handoff_title()}</h1>
			<p class="handoffmsg">{error}</p>
			<Button variant="primary" size="lg" href={appOrigin()}>{m.cal_fork_back()}</Button>
		{:else}
			<p class="handoffmsg">{m.handoff_opening()}</p>
		{/if}
	</div>
</AuthShell>

<style>
	.handoffcard {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.handoffmsg {
		color: var(--muted-foreground);
	}
</style>
