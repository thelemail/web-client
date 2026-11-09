<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { localForkPath } from '$core/fork';
	import { auth } from '$core/stores/auth.svelte';
	import { m } from '$paraglide/messages.js';
	import { HandoffError } from './begin';
	import { completeHandoff, takeCallbackFragment } from './complete';

	const fragment = takeCallbackFragment();
	let error = $state<string | null>(null);

	onMount(() => {
		void run();
	});

	async function run() {
		if (!fragment) {
			error = m.handoff_failed();
			return;
		}
		try {
			const done = await completeHandoff(fragment);
			auth.activate(done.accountId);
			await goto(localForkPath(done.route, done.slot), { replace: true });
		} catch (err) {
			error = err instanceof HandoffError && err.code === 'account' ? m.handoff_wrong_account() : m.handoff_failed();
		}
	}
</script>

<AuthShell>
	<div class="card handoffcard" aria-live="polite">
		{#if error}
			<h1>{m.handoff_title()}</h1>
			<p class="handoffmsg">{error}</p>
			<Button variant="primary" size="lg" href="/">{m.handoff_restart()}</Button>
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
