<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowsRotate,
		faCircleExclamation,
		faFingerprint,
		faKey,
		faLifeRing,
		faLock,
		faMobile,
		faPencil,
		faPlus,
		faShieldCheck,
		faShieldSlash,
		faTriangleExclamation,
		faUsbDrive
	} from '@fortawesome/pro-regular-svg-icons';
	import Card from '../Card.svelte';
	import { Badge } from '$core/components/ui/badge';
	import CeremonyRow from '../CeremonyRow.svelte';
	import TwoFactorBackupCodesDialog from '../TwoFactorBackupCodesDialog.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { auth } from '$core/stores/session.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import { regenerateBackupCodes, totpDisable, webauthnDelete, webauthnRename } from '$core/api/twofactor';
	import { ApiCallError } from '$core/api/types';
	import { KEY_NAME_MAX_LENGTH } from '$core/settings/keyName';
	import { webauthnSupported } from '$core/auth/webauthn';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { fmtDate } from './format';
	import { securityActivity } from './activity.svelte';
	import type { CeremonyKind, TwoFaSetupMethod } from '../data';

	interface Props {
		launch: (k: CeremonyKind, opts?: { method?: TwoFaSetupMethod }) => void;
	}

	let { launch }: Props = $props();

	$effect(() => {
		if (auth.accountId) twofactor.ensure(auth.accountId);
	});

	type FactorAction =
		| { kind: 'disableTotp' }
		| { kind: 'deleteKey'; id: string; name: string }
		| { kind: 'renameKey'; id: string; name: string }
		| { kind: 'regenCodes' };

	let factorAction = $state<FactorAction | null>(null);
	let factorBusy = $state(false);
	let factorError = $state<string | null>(null);
	let newCodes = $state<string[] | null>(null);
	let renameValue = $state('');
	const renameReady = $derived(
		factorAction?.kind !== 'renameKey' ||
			(renameValue.trim().length > 0 && renameValue.trim() !== factorAction.name)
	);

	const tfStatus = $derived(twofactor.status);

	const factorCopy = $derived.by(() => {
		const a = factorAction;
		const st = twofactor.status;
		if (!a || !st) return { title: '', desc: '', confirmLabel: '', danger: false };
		const methodCount = (st.totp?.active ? 1 : 0) + st.webauthnCredentials.length;
		switch (a.kind) {
			case 'disableTotp':
				return {
					title: m.settings_security_totp_remove_title(),
					desc:
						methodCount <= 1
							? m.settings_security_last_factor_warning()
							: m.settings_security_totp_remove_desc(),
					confirmLabel: m.settings_security_totp_remove_confirm(),
					danger: true
				};
			case 'deleteKey':
				return {
					title: m.settings_security_key_remove_title({ name: a.name }),
					desc:
						methodCount <= 1
							? m.settings_security_last_factor_warning()
							: m.settings_security_key_remove_desc(),
					confirmLabel: m.settings_security_key_remove_confirm(),
					danger: true
				};
			case 'renameKey':
				return {
					title: m.settings_security_key_rename_title({ name: a.name }),
					desc: m.settings_security_key_rename_desc(),
					confirmLabel: m.common_save(),
					danger: false
				};
			case 'regenCodes':
				return {
					title: m.settings_security_backup_regen_title(),
					desc: m.settings_security_backup_regen_desc(),
					confirmLabel: m.settings_security_backup_regen(),
					danger: false
				};
		}
	});

	function openFactorAction(a: FactorAction) {
		factorError = null;
		if (a.kind === 'renameKey') renameValue = a.name;
		factorAction = a;
	}

	async function confirmFactorAction() {
		const a = factorAction;
		if (!a || factorBusy || !renameReady) return;
		const accountId = auth.accountId ?? undefined;
		factorBusy = true;
		factorError = null;
		try {
			if (a.kind === 'disableTotp') {
				const res = await totpDisable(accountId);
				await auth.adoptRotatedSession(res.session);
			} else if (a.kind === 'deleteKey') {
				const res = await webauthnDelete(a.id, accountId);
				await auth.adoptRotatedSession(res.session);
			} else if (a.kind === 'renameKey') {
				await webauthnRename(a.id, renameValue.trim(), accountId);
			} else {
				const res = await regenerateBackupCodes(accountId);
				await auth.adoptRotatedSession(res.session);
				newCodes = res.backupCodes ?? [];
			}
			factorAction = null;
			void twofactor.load(accountId);
			securityActivity.touch();
		} catch (err) {
			if (isReauthenticationRequired(err)) return;
			console.warn('twofa: factor change failed', err);
			factorError =
				err instanceof ApiCallError && err.status === 503
					? m.settings_ceremony_twofa_err_unavailable()
					: m.common_something_went_wrong();
		} finally {
			factorBusy = false;
		}
	}

	function selectOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function keyMeta(cred: { createdAt?: string; lastUsedAt?: string | null; backupState?: boolean }): string {
		const parts = [m.settings_security_key_added({ date: fmtDate(cred.createdAt) })];
		if (cred.lastUsedAt) parts.push(m.settings_security_key_last_used({ date: fmtDate(cred.lastUsedAt) }));
		if (cred.backupState) parts.push(m.settings_security_key_synced());
		return parts.join(' · ');
	}
</script>

{#snippet turnOnLink(t: string)}<button type="button" class="notelink" onclick={() => launch('twofa')}>{t}</button>{/snippet}

<Card icon={faKey} title={m.settings_security_signin_title()} variant="flat">
	{#snippet right()}
		{#if tfStatus}
			{#if tfStatus.enabled}
				<Badge tone="success" status>{m.settings_security_2fa_on()}</Badge>
			{:else}
				<Badge tone="warning" status>{m.settings_security_2fa_off()}</Badge>
			{/if}
		{:else if twofactor.phase === 'error'}
			<Badge tone="neutral">{m.settings_security_2fa_unknown()}</Badge>
		{:else}
			<Badge tone="neutral">{m.settings_security_2fa_checking()}</Badge>
		{/if}
	{/snippet}
	<div class="cer-rows">
		<CeremonyRow
			icon={faLock}
			title={m.settings_security_password_title()}
			desc={m.settings_security_password_desc()}
			cta={m.settings_security_password_cta()}
			onLaunch={() => launch('password')}
		/>
	</div>
	<div class="tfa-sub">
		<Icon icon={faShieldCheck} size={13} />{m.settings_security_2fa_methods()}
		<span class="tfa-sub-note">{m.settings_security_2fa_methods_note()}</span>
	</div>
	{#if twofactor.phase === 'error'}
		<div class="setrow set-loaderr" role="alert">
			<Icon icon={faCircleExclamation} size={16} />
			<p>{m.settings_security_2fa_load_failed()}</p>
			<Button variant="neutral" size="sm" onclick={() => void twofactor.load(auth.accountId)}>
				<Icon icon={faArrowsRotate} />{m.common_retry()}
			</Button>
		</div>
	{/if}
	{#if tfStatus}
		{#each tfStatus.webauthnCredentials as cred (cred.id)}
			<div class="tfa-row">
				<span class="tfa-ic">
					{#if cred.kind === 'platform'}<Icon icon={faFingerprint} size={18} />{:else}<Icon icon={faUsbDrive} size={18} />{/if}
				</span>
				<div class="tfa-info">
					<div class="tfa-t">{cred.name}<Badge tone="success">{m.settings_security_on()}</Badge></div>
					<div class="tfa-d">
						{keyMeta(cred)}
					</div>
					{#if cred.userVerified === false}
						<div class="tfa-d tfa-warn">
							<Icon icon={faTriangleExclamation} size={12} />{m.settings_security_key_no_pin()}
						</div>
					{/if}
				</div>
				<div class="tfa-act">
					<Button variant="ghost" size="sm" onclick={() => openFactorAction({ kind: 'renameKey', id: cred.id, name: cred.name })}>
						{m.settings_security_key_rename()}
					</Button>
					<Button variant="ghost" size="sm" onclick={() => openFactorAction({ kind: 'deleteKey', id: cred.id, name: cred.name })}>
						{m.common_remove()}
					</Button>
				</div>
			</div>
		{/each}
		{#if webauthnSupported()}
			<div class="tfa-row off">
				<span class="tfa-ic"><Icon icon={faFingerprint} size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_this_device()}</div>
					<div class="tfa-d">{m.settings_security_this_device_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="tonal" size="sm" onclick={() => launch('twofa', { method: 'device' })}>
						<Icon icon={faPlus} size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
			<div class="tfa-row off">
				<span class="tfa-ic"><Icon icon={faUsbDrive} size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_key()}</div>
					<div class="tfa-d">{m.settings_security_key_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="tonal" size="sm" onclick={() => launch('twofa', { method: 'key' })}>
						<Icon icon={faPlus} size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
		{/if}
		{#if tfStatus?.totp?.active}
			<div class="tfa-row">
				<span class="tfa-ic"><Icon icon={faMobile} size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_totp()}<Badge tone="success">{m.settings_security_on()}</Badge></div>
					<div class="tfa-d">
						{m.settings_security_totp_meta({ date: fmtDate(tfStatus.totp.createdAt) })}
					</div>
				</div>
				<div class="tfa-act">
					<Button variant="ghost" size="sm" onclick={() => openFactorAction({ kind: 'disableTotp' })}>
						{m.common_remove()}
					</Button>
				</div>
			</div>
		{:else}
			<div class="tfa-row off">
				<span class="tfa-ic"><Icon icon={faMobile} size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_totp()}</div>
					<div class="tfa-d">{m.settings_security_totp_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="tonal" size="sm" onclick={() => launch('twofa', { method: 'totp' })}>
						<Icon icon={faPlus} size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
		{/if}
		{#if tfStatus?.enabled}
			<div class="tfa-row backup">
				<span class="tfa-ic"><Icon icon={faLifeRing} size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_backup_codes()}</div>
					<div class="tfa-d">
						{m.settings_security_backup_codes_meta({ count: tfStatus.backupCodes?.remaining ?? 0 })}
					</div>
				</div>
				<div class="tfa-act">
					<Button variant="ghost" size="sm" onclick={() => openFactorAction({ kind: 'regenCodes' })}>
						<Icon icon={faArrowsRotate} size={14} />{m.settings_security_backup_regen()}
					</Button>
				</div>
			</div>
			{#if tfStatus.backupCodes?.outdated}
				<div class="card-note warn">
					<Icon icon={faTriangleExclamation} size={13} />
					<span>{m.settings_security_backup_outdated()}</span>
				</div>
			{/if}
		{:else}
			<div class="card-note warn">
				<Icon icon={faTriangleExclamation} size={13} />
				<span>
					<Rich text={m.settings_security_2fa_off_note()} tags={{ link: turnOnLink }} />
				</span>
			</div>
		{/if}
	{:else if twofactor.phase !== 'error'}
		<div class="set-skel" aria-busy="true">
			<span class="sr-only">{m.settings_security_2fa_loading()}</span>
			{#each [0, 1] as i (i)}
				<div class="setrow" aria-hidden="true">
					<div class="info">
						<span class="sk-bar sk-t"></span>
						<span class="sk-bar sk-d"></span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</Card>

{#snippet factorBody()}
	<p class="dialog-p">{factorCopy.desc}</p>
	{#if factorAction?.kind === 'renameKey'}
		<label class="dialog-field">
			<span class="dialog-label">{m.settings_ceremony_twofa_key_name_label()}</span>
			<input
				{@attach selectOnMount}
				bind:value={renameValue}
				class="field-input"
				maxlength={KEY_NAME_MAX_LENGTH}
				autocomplete="off"
				spellcheck={false}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void confirmFactorAction();
					}
				}}
			/>
		</label>
	{/if}
{/snippet}

{#if factorAction}
	<ConfirmDialog
		icon={factorCopy.danger ? faShieldSlash : factorAction.kind === 'renameKey' ? faPencil : faArrowsRotate}
		tone={factorCopy.danger ? 'danger' : 'neutral'}
		title={factorCopy.title}
		confirmLabel={factorCopy.confirmLabel}
		busy={factorBusy}
		disabled={!renameReady}
		error={factorError}
		body={factorBody}
		onConfirm={() => void confirmFactorAction()}
		onClose={() => {
			if (!factorBusy) factorAction = null;
		}}
	/>
{/if}

{#if newCodes}
	<TwoFactorBackupCodesDialog codes={newCodes} onClose={() => (newCodes = null)} />
{/if}

<style>
	.notelink {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--warning-700);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
