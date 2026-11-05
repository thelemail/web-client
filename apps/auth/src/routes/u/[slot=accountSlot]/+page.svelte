<script lang="ts">
	import { goto } from '$app/navigation';
	import { m } from '$paraglide/messages.js';
	import { auth } from '$core/stores/session.svelte';
	import { appOrigin } from '$core/products';
	import { EXPORT_TOOL_URL } from '$core/settings/exportTool';
	import SecHead from '$core/settings/SecHead.svelte';
	import SecGroup from '$core/settings/security/SecGroup.svelte';
	import RecoveryHero from '$core/settings/security/RecoveryHero.svelte';
	import SignInCard from '$core/settings/security/SignInCard.svelte';
	import SessionsCard from '$core/settings/security/SessionsCard.svelte';
	import SecurityLog from '$core/settings/security/SecurityLog.svelte';
	import RecoveryCeremony from '$core/settings/ceremonies/RecoveryCeremony.svelte';
	import PasswordCeremony from '$core/settings/ceremonies/PasswordCeremony.svelte';
	import TwoFactorCeremony from '$core/settings/ceremonies/TwoFactorCeremony.svelte';
	import type { CeremonyKind, TwoFaSetupMethod } from '$core/settings/data';
	import Card from '$core/settings/Card.svelte';
	import Row from '$core/settings/Row.svelte';
	import { Button } from '$core/components/ui/button';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	let active = $state<CeremonyKind | null>(null);
	let twoFaMethod = $state<TwoFaSetupMethod | undefined>(undefined);
	let signingOut = $state(false);

	function launch(kind: CeremonyKind, opts?: { method?: TwoFaSetupMethod }) {
		if (kind !== 'recovery' && kind !== 'password' && kind !== 'twofa') return;
		twoFaMethod = opts?.method;
		active = kind;
	}

	function close() {
		active = null;
	}

	async function signOut() {
		if (signingOut) return;
		signingOut = true;
		try {
			await auth.logout();
		} finally {
			await goto('/login');
		}
	}
</script>

<svelte:head>
	<title>{m.auth_account_page_title()}</title>
</svelte:head>

<div class="settings-app">
	<div class="settings-body">
		<div class="set-col">
			<header class="set-head">
				<h1>{m.settings_nav_security()}</h1>
				<div class="set-head-actions">
					<Button variant="ghost" href={appOrigin()}>{m.auth_signed_in_open_mailbox()}</Button>
					<Button variant="secondary" onclick={signOut} disabled={signingOut}>
						{m.settings_security_sign_out()}
					</Button>
				</div>
			</header>
			<div class="set-scroll">
				<div class="set-content">
					<SecHead desc={m.settings_security_desc()} />

					<SecGroup id="sec-access" title={m.settings_security_group_access()}>
						<RecoveryHero {launch} />
						<SignInCard {launch} />
						<SessionsCard />
					</SecGroup>

					<Card icon={Download} title={m.settings_account_export_title()}>
						<Row t={m.settings_account_export_row()} d={m.settings_account_export_desc()}>
							<Button
								variant="secondary"
								size="sm"
								href={EXPORT_TOOL_URL}
								target="_blank"
								rel="noreferrer noopener"
							>
								{m.settings_account_export_button()}<ExternalLink size={14} />
							</Button>
						</Row>
					</Card>

					<SecGroup id="sec-log" title={m.settings_security_log()}>
						<SecurityLog />
					</SecGroup>
				</div>
			</div>
		</div>
	</div>
</div>

{#if active === 'recovery'}
	<RecoveryCeremony onClose={close} onComplete={close} />
{:else if active === 'password'}
	<PasswordCeremony onClose={close} onComplete={close} />
{:else if active === 'twofa'}
	<TwoFactorCeremony onClose={close} onComplete={close} initialMethod={twoFaMethod} />
{/if}

<style>
	.set-head-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}
</style>
