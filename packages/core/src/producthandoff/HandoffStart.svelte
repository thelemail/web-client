<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import Status from '$core/auth/form/Status.svelte';
	import { Button } from '$core/components/ui/button';
	import { signInAtAuth, unlockAtAuth } from '$core/custody/unlock';
	import { localForkPath } from '$core/fork';
	import { appOrigin } from '$core/products';
	import { accounts } from '$core/stores/accounts.svelte';
	import { m } from '$paraglide/messages.js';
	import { startFor } from './fallback';
	import { markAuthTab } from './tab';

	const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
	history.replaceState(null, '', window.location.pathname);
	let error = $state<string | null>(null);

	async function inTab(accountId: string | null, route: string): Promise<never> {
		window.opener = null;
		markAuthTab();
		await accounts.load();
		return accountId ? unlockAtAuth(accountId, route) : signInAtAuth(route);
	}

	async function open(accountId: string | null, route: string): Promise<void> {
		if (params.get('tab') === '1') return inTab(accountId, route);
		if (accountId) {
			await accounts.load();
			const known = accounts.byId(accountId);
			if (known) return goto(localForkPath(route, known.slot), { replace: true });
		}
		return startFor(accountId, route, params.get('intent') === 'register' ? 'register' : undefined);
	}

	onMount(() => {
		const account = params.get('account');
		const accountId = account && /^[0-9a-f-]{36}$/.test(account) ? account : null;
		void open(accountId, params.get('route') ?? '/').catch(() => {
			error = m.handoff_failed();
		});
	});
</script>

<AuthShell>
	<div class="card" aria-live="polite">
		{#if error}
			<div class="card-surface">
				<div class="card-head">
					<h1>{m.handoff_title()}</h1>
					<p>{error}</p>
				</div>
				<Button variant="primary" size="lg" block href={appOrigin()}>{m.cal_fork_back()}</Button>
			</div>
		{:else}
			<div class="af-wait"><Status tone="busy">{m.handoff_opening()}</Status></div>
		{/if}
	</div>
</AuthShell>
