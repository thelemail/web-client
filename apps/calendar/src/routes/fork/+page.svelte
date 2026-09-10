<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { adoptFork, ForkError, localForkPath } from '$core/fork';
	import { getPersistentHalf } from '$core/api/auth';
	import { keystore } from '$core/keystore/keystore-client';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { appOrigin } from '$core/products';

	let error = $state<string | null>(null);

	onMount(() => {
		void run();
	});

	async function rememberVault(accountId: string) {
		try {
			const { serverHalf } = await getPersistentHalf(accountId);
			await keystore.enrollPersistent({ accountId, serverHalf });
		} catch {
			return;
		}
	}

	async function run() {
		try {
			const adopted = await adoptFork(window.location.hash);
			const existing = accounts.byId(adopted.accountId);
			const now = Date.now();
			const slot = existing?.slot ?? accounts.allocateSlot();
			await accounts.upsert({
				accountId: adopted.accountId,
				slot,
				email: adopted.email,
				addedAt: existing?.addedAt ?? now,
				lastActiveAt: now
			});
			auth.activate(adopted.accountId);
			await rememberVault(adopted.accountId);
			history.replaceState(null, '', '/fork');
			const target = localForkPath(adopted.redirect, slot);
			await goto(target, { replaceState: true });
		} catch (err) {
			history.replaceState(null, '', '/fork');
			error = err instanceof ForkError ? err.message : 'This link could not be opened.';
		}
	}
</script>

{#if error}
	<AuthShell>
		<div class="card forkcard">
			<h1>Calendar could not open</h1>
			<p class="forkmsg">{error}</p>
			<Button variant="primary" size="lg" href={appOrigin()}>Back to Thelemail</Button>
		</div>
	</AuthShell>
{/if}

<style>
	.forkcard {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.forkmsg {
		color: var(--muted-foreground);
	}
</style>
