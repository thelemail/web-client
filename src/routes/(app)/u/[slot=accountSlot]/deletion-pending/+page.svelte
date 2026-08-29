<script lang="ts">
	import { goto } from '$app/navigation';
	import AuthShell from '$lib/auth/AuthShell.svelte';
	import { cancelDeletion } from '$lib/api/deletion';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import LogOut from '@lucide/svelte/icons/log-out';

	let { data } = $props();

	let busy = $state(false);
	let cancelError = $state<string | null>(null);

	const slot = $derived(data.slot);
	const deletion = $derived(auth.deletion);

	const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
	const requestedLabel = $derived(deletion ? fmt.format(new Date(deletion.requestedAt)) : '');
	const purgeLabel = $derived(deletion ? fmt.format(new Date(deletion.purgeAt)) : '');
	const daysLeft = $derived.by(() => {
		if (!deletion) return 0;
		return Math.max(0, Math.ceil((new Date(deletion.purgeAt).getTime() - Date.now()) / 86_400_000));
	});

	$effect(() => {
		if (!deletion) {
			void goto(`/u/${slot}/mail/inbox`);
		}
	});

	async function keepAccount() {
		if (busy) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		busy = true;
		cancelError = null;
		try {
			await cancelDeletion(accountId);
			await auth.loadProfile(accountId);
			await goto(`/u/${slot}/mail/inbox`);
		} catch (err) {
			console.warn('deletion: cancel failed', err);
			cancelError = 'Could not cancel the deletion. Check your connection and try again.';
			busy = false;
		}
	}

	async function signOut() {
		const id = auth.accountId;
		if (id) await auth.logoutAccount(id);
		const remaining = accounts.list[0];
		if (remaining) {
			auth.activate(remaining.accountId);
			await goto(`/u/${remaining.slot}/mail/inbox`);
		} else {
			await goto('/login');
		}
	}
</script>

<svelte:head>
	<title>Thelemail — Deletion scheduled</title>
</svelte:head>

<AuthShell>
	<div class="card">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<span class="pending-icon"><CalendarClock size={44} strokeWidth={1.5} /></span>
				<h1>Deletion scheduled</h1>
				<p>
					This account was scheduled for deletion on <b>{requestedLabel}</b>. Everything it holds
					— every mailbox, alias, and message — will be permanently erased on
					<b>{purgeLabel}</b>{daysLeft > 0 ? ` (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)` : ''}.
				</p>
				<p>
					Until then the account is deactivated: mail still arrives, but nothing can be read or
					sent. Changed your mind? You can keep the account and everything in it.
				</p>
				{#if cancelError}
					<p class="billing-notice billing-notice-error">
						<CircleAlert size={15} strokeWidth={1.75} />
						<span>{cancelError}</span>
					</p>
				{/if}
				<div class="actions" style="margin-top:24px">
					<button class="btn btn-primary btn-block" disabled={busy} onclick={keepAccount}>
						<Undo2 size={17} strokeWidth={1.75} />
						{busy ? 'Restoring your account…' : 'Cancel deletion and keep my account'}
					</button>
					<button class="btn btn-secondary btn-block" disabled={busy} onclick={signOut}>
						<LogOut size={17} strokeWidth={1.75} />Sign out
					</button>
				</div>
			</div>
		</div>
	</div>
</AuthShell>

<style>
	.pending-icon {
		display: inline-flex;
		color: var(--ink-500);
		margin-bottom: 6px;
	}
</style>
