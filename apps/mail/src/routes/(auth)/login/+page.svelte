<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { Button } from '$core/components/ui/button';
	import { mailOnlyAccountId, unlockAtAuth } from '$core/custody/unlock';
	import { delayed } from '$core/async/delayed.svelte';
	import { m } from '$paraglide/messages.js';

	const slot = page.url.searchParams.get('slot');
	let mode = $state<'checking' | 'password' | 'auth' | 'failed'>(slot === null ? 'password' : 'checking');
	const checking = delayed(() => mode === 'checking', { minVisible: 0 });

	function redirect(): string | null {
		return page.url.searchParams.get('redirect');
	}

	async function open(accountId: string): Promise<void> {
		mode = 'auth';
		try {
			await unlockAtAuth(accountId, redirect());
		} catch {
			mode = 'failed';
		}
	}

	async function intercept(identifier: string): Promise<boolean> {
		const accountId = await mailOnlyAccountId({ identifier });
		if (!accountId) return false;
		void open(accountId);
		return true;
	}

	onMount(() => {
		if (slot === null) return;
		void mailOnlyAccountId({ slot: Number(slot) })
			.catch(() => null)
			.then((accountId) => {
				if (accountId) void open(accountId);
				else mode = 'password';
			});
	});
</script>

{#if mode === 'password'}
	<LoginFlow {intercept} afterSignIn={(slot) => goto(resolveReturnTo(redirect(), slot))} />
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
