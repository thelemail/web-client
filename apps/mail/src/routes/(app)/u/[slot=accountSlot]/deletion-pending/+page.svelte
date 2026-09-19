<script lang="ts">
	import { i18n } from '$core/i18n/locale.svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { cancelDeletion } from '$core/api/deletion';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { data } = $props();

	let busy = $state(false);
	let cancelError = $state<string | null>(null);

	const slot = $derived(data.slot);
	const deletion = $derived(auth.deletion);

	const fmt = $derived(new Intl.DateTimeFormat(i18n.tag, { dateStyle: 'long' }));
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
			cancelError = m.lc_deletion_cancel_failed();
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
	<title>{m.lc_page_title_deletion()}</title>
</svelte:head>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<AuthShell>
	<div class="card">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<span class="pending-icon"><CalendarClock size={44} strokeWidth={1.5} /></span>
				<h1>{m.lc_deletion_title()}</h1>
				<p>
					<Rich
						text={daysLeft > 0
							? m.lc_deletion_body_days({
									count: daysLeft,
									requested: requestedLabel,
									purge: purgeLabel
								})
							: m.lc_deletion_body({ requested: requestedLabel, purge: purgeLabel })}
						tags={{ b: bold }}
					/>
				</p>
				<p>
					{m.lc_deletion_deactivated()}
				</p>
				{#if cancelError}
					<p class="billing-notice billing-notice-error">
						<CircleAlert size={15} strokeWidth={1.75} />
						<span>{cancelError}</span>
					</p>
				{/if}
				<div class="actions" style="margin-top:24px">
					<Button variant="primary" size="lg" block disabled={busy} onclick={keepAccount}>
						<Undo2 size={17} strokeWidth={1.75} />
						{busy ? m.lc_deletion_restoring() : m.lc_deletion_keep()}
					</Button>
					<Button variant="secondary" size="lg" block disabled={busy} onclick={signOut}>
						<LogOut size={17} strokeWidth={1.75} />{m.lc_deletion_sign_out()}
					</Button>
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
