<script lang="ts">
	import { i18n } from '$core/i18n/locale.svelte';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { cancelDeletion } from '$core/api/deletion';
	import { auth } from '$core/stores/session.svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRightFromBracket,
		faArrowRotateLeft,
		faCalendarClock,
		faCircleExclamation
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { accountId, onKept, onSignedOut }: { accountId: string; onKept: () => Promise<unknown>; onSignedOut: () => Promise<unknown> } = $props();

	let busy = $state(false);
	let cancelError = $state<string | null>(null);

	const deletion = $derived(auth.deletionFor(accountId));

	const fmt = $derived(new Intl.DateTimeFormat(i18n.tag, { dateStyle: 'long' }));
	const requestedLabel = $derived(deletion ? fmt.format(new Date(deletion.requestedAt)) : '');
	const purgeLabel = $derived(deletion ? fmt.format(new Date(deletion.purgeAt)) : '');
	const daysLeft = $derived.by(() => {
		if (!deletion) return 0;
		return Math.max(0, Math.ceil((new Date(deletion.purgeAt).getTime() - Date.now()) / 86_400_000));
	});

	async function keepAccount() {
		if (busy) return;
		busy = true;
		cancelError = null;
		try {
			await cancelDeletion(accountId);
			await auth.loadProfile(accountId);
			await onKept();
		} catch (err) {
			console.warn('deletion: cancel failed', err);
			cancelError = m.lc_deletion_cancel_failed();
			busy = false;
		}
	}

	async function signOut() {
		await auth.logoutAccount(accountId);
		await onSignedOut();
	}
</script>

<svelte:head>
	<title>{m.lc_page_title_deletion()}</title>
</svelte:head>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<AuthShell>
	<div class="card">
		<div class="card-surface">
			<div class="welcome">
				<span class="pending-icon"><Icon icon={faCalendarClock} size={44} /></span>
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
						<Icon icon={faCircleExclamation} size={15} />
						<span>{cancelError}</span>
					</p>
				{/if}
				<div class="actions" style="margin-top:24px">
					<Button variant="primary" size="lg" block disabled={busy} onclick={keepAccount}>
						<Icon icon={faArrowRotateLeft} size={17} />
						{busy ? m.lc_deletion_restoring() : m.lc_deletion_keep()}
					</Button>
					<Button variant="secondary" size="lg" block disabled={busy} onclick={signOut}>
						<Icon icon={faArrowRightFromBracket} size={17} />{m.lc_deletion_sign_out()}
					</Button>
				</div>
			</div>
		</div>
	</div>
</AuthShell>

<style>
	.pending-icon {
		display: inline-flex;
		color: var(--fg-muted);
		margin-bottom: 6px;
	}
</style>
