<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { Button } from '$core/components/ui/button';
	import { mailOnlyAccountId, signInAtAuth, signInMovedToAuth, unlockAtAuth } from '$core/custody/unlock';
	import { keystore } from '$core/keystore/keystore-client';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/session.svelte';
	import { delayed } from '$core/async/delayed.svelte';
	import { m } from '$paraglide/messages.js';

	const slot = page.url.searchParams.get('slot');
	let mode = $state<'checking' | 'password' | 'auth' | 'failed'>('checking');
	const checking = delayed(() => mode === 'checking', { minVisible: 0 });

	function redirect(): string | null {
		return page.url.searchParams.get('redirect');
	}

	async function open(accountId: string | null): Promise<void> {
		mode = 'auth';
		try {
			await (accountId ? unlockAtAuth(accountId, redirect()) : signInAtAuth(redirect()));
		} catch {
			mode = 'failed';
		}
	}

	async function signedIn(signedSlot: number): Promise<void> {
		const accountId = accounts.bySlot(signedSlot)?.accountId;
		if (accountId) {
			await auth.loadProfile(accountId).catch(() => undefined);
			if (auth.mailOnlyFor(accountId) && auth.authOriginEnrolledFor(accountId)) {
				await keystore.lock({ accountId }).catch(() => undefined);
				await open(accountId);
				return;
			}
		}
		await goto(resolveReturnTo(redirect(), signedSlot));
	}

	async function decide(): Promise<void> {
		const accountId = slot === null ? null : await mailOnlyAccountId({ slot: Number(slot) }).catch(() => null);
		if (accountId) return open(accountId);
		if (await signInMovedToAuth()) return open(slot === null ? null : (accounts.bySlot(Number(slot))?.accountId ?? null));
		mode = 'password';
	}

	async function intercept(identifier: string): Promise<boolean> {
		const accountId = await mailOnlyAccountId({ identifier });
		if (!accountId) return false;
		void open(accountId);
		return true;
	}

	onMount(() => {
		void decide();
	});
</script>

{#if mode === 'password'}
	<LoginFlow {intercept} afterSignIn={signedIn} />
{:else if mode === 'checking'}
	<div class="unlockcard" aria-busy="true" aria-live="polite">
		{#if checking.visible}
			<p class="unlockmsg">{m.common_loading()}</p>
		{/if}
	</div>
{:else}
	<div class="unlockcard" aria-live="polite">
		{#if mode === 'failed'}
			<h1>{m.handoff_title()}</h1>
			<p class="unlockmsg">{m.handoff_failed()}</p>
			<Button variant="primary" size="lg" href={page.url.pathname + page.url.search}>{m.handoff_restart()}</Button>
		{:else}
			<p class="unlockmsg">{m.handoff_opening()}</p>
		{/if}
	</div>
{/if}

<style>
	.unlockcard {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.unlockmsg {
		color: var(--muted-foreground);
	}
</style>
