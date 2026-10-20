<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Pencil from '@lucide/svelte/icons/pencil';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import Usb from '@lucide/svelte/icons/usb';
	import Lock from '@lucide/svelte/icons/lock';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CardHead from '../CardHead.svelte';
	import Badge from '../Badge.svelte';
	import CeremonyRow from '../CeremonyRow.svelte';
	import TwoFactorBackupCodesDialog from '../TwoFactorBackupCodesDialog.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { auth } from '$core/stores/auth.svelte';
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

<div class="scard flat">
	<CardHead icon={KeyRound} title={m.settings_security_signin_title()}>
		{#snippet right()}
			{#if tfStatus}
				{#if tfStatus.enabled}
					<Badge kind="ok" dot>{m.settings_security_2fa_on()}</Badge>
				{:else}
					<Badge kind="warn" dot>{m.settings_security_2fa_off()}</Badge>
				{/if}
			{:else if twofactor.phase === 'error'}
				<Badge kind="neutral">{m.settings_security_2fa_unknown()}</Badge>
			{:else}
				<Badge kind="neutral">{m.settings_security_2fa_checking()}</Badge>
			{/if}
		{/snippet}
	</CardHead>
	<div class="cer-rows">
		<CeremonyRow
			icon={Lock}
			title={m.settings_security_password_title()}
			desc={m.settings_security_password_desc()}
			cta={m.settings_security_password_cta()}
			onLaunch={() => launch('password')}
		/>
	</div>
	<div class="tfa-sub">
		<ShieldCheckIcon size={13} />{m.settings_security_2fa_methods()}
		<span class="tfa-sub-note">{m.settings_security_2fa_methods_note()}</span>
	</div>
	{#if twofactor.phase === 'error'}
		<div class="setrow set-loaderr" role="alert">
			<CircleAlert size={16} />
			<p>{m.settings_security_2fa_load_failed()}</p>
			<Button variant="secondary" size="sm" onclick={() => void twofactor.load(auth.accountId)}>
				<RefreshCw />{m.common_retry()}
			</Button>
		</div>
	{/if}
	{#if tfStatus}
		{#each tfStatus.webauthnCredentials as cred (cred.id)}
			<div class="tfa-row">
				<span class="tfa-ic">
					{#if cred.backupState}<Fingerprint size={18} />{:else}<Usb size={18} />{/if}
				</span>
				<div class="tfa-info">
					<div class="tfa-t">{cred.name}<Badge kind="ok">{m.settings_security_on()}</Badge></div>
					<div class="tfa-d">
						{keyMeta(cred)}
					</div>
					{#if cred.userVerified === false}
						<div class="tfa-d tfa-warn">
							<TriangleAlert size={12} />{m.settings_security_key_no_pin()}
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
				<span class="tfa-ic"><Fingerprint size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_this_device()}</div>
					<div class="tfa-d">{m.settings_security_this_device_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="secondary" size="sm" onclick={() => launch('twofa', { method: 'device' })}>
						<Plus size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
			<div class="tfa-row off">
				<span class="tfa-ic"><Usb size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_key()}</div>
					<div class="tfa-d">{m.settings_security_key_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="secondary" size="sm" onclick={() => launch('twofa', { method: 'key' })}>
						<Plus size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
		{/if}
		{#if tfStatus?.totp?.active}
			<div class="tfa-row">
				<span class="tfa-ic"><Smartphone size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_totp()}<Badge kind="ok">{m.settings_security_on()}</Badge></div>
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
				<span class="tfa-ic"><Smartphone size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_totp()}</div>
					<div class="tfa-d">{m.settings_security_totp_desc()}</div>
				</div>
				<div class="tfa-act">
					<Button variant="secondary" size="sm" onclick={() => launch('twofa', { method: 'totp' })}>
						<Plus size={14} />{m.settings_security_setup()}
					</Button>
				</div>
			</div>
		{/if}
		{#if tfStatus?.enabled}
			<div class="tfa-row backup">
				<span class="tfa-ic"><LifeBuoy size={18} /></span>
				<div class="tfa-info">
					<div class="tfa-t">{m.settings_security_backup_codes()}</div>
					<div class="tfa-d">
						{m.settings_security_backup_codes_meta({ count: tfStatus.backupCodes?.remaining ?? 0 })}
					</div>
				</div>
				<div class="tfa-act">
					<Button variant="ghost" size="sm" onclick={() => openFactorAction({ kind: 'regenCodes' })}>
						<RefreshCw size={14} />{m.settings_security_backup_regen()}
					</Button>
				</div>
			</div>
			{#if tfStatus.backupCodes?.outdated}
				<div class="card-note warn">
					<TriangleAlert size={13} />
					<span>{m.settings_security_backup_outdated()}</span>
				</div>
			{/if}
		{:else}
			<div class="card-note warn">
				<TriangleAlert size={13} />
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
</div>

{#snippet factorBody()}
	<p class="cfd-p">{factorCopy.desc}</p>
	{#if factorAction?.kind === 'renameKey'}
		<label class="cfd-field">
			<span class="cfd-label">{m.settings_ceremony_twofa_key_name_label()}</span>
			<input
				{@attach selectOnMount}
				bind:value={renameValue}
				class="cfd-input"
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
		icon={factorCopy.danger ? ShieldOff : factorAction.kind === 'renameKey' ? Pencil : RefreshCw}
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
