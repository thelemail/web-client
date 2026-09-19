<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Download from '@lucide/svelte/icons/download';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import Usb from '@lucide/svelte/icons/usb';
	import Lock from '@lucide/svelte/icons/lock';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Globe from '@lucide/svelte/icons/globe';
	import LogOut from '@lucide/svelte/icons/log-out';
	import KeySquare from '@lucide/svelte/icons/key-square';
	import Copy from '@lucide/svelte/icons/copy';
	import Upload from '@lucide/svelte/icons/upload';
	import Plus from '@lucide/svelte/icons/plus';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import LogIn from '@lucide/svelte/icons/log-in';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Badge from '../Badge.svelte';
	import Toggle from '../Toggle.svelte';
	import CardHead from '../CardHead.svelte';
	import CeremonyRow from '../CeremonyRow.svelte';
	import type { DeviceIcon } from '../types';
	import { auth } from '$core/stores/auth.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import {
		regenerateBackupCodes,
		totpDisable,
		webauthnDelete
	} from '$core/api/twofactor';
	import { listSessions, listSecurityEvents, revokeSession, revokeOtherSessions } from '$core/api/auth';
	import type {
		SecurityEventAction,
		SecurityEventInfo,
		SessionClient,
		SessionInfo,
		TwoFactorMethod,
		TwoFactorProof
	} from '$core/api/types';
	import { webauthnSupported } from '$core/auth/webauthn';
	import { keystore } from '$core/keystore/keystore-client';
	import TwoFactorProofDialog from '../TwoFactorProofDialog.svelte';
	import TwoFactorBackupCodesDialog from '../TwoFactorBackupCodesDialog.svelte';
	import type { SettingsState, CeremonyKind, TwoFaSetupMethod } from '../data';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
		launch: (k: CeremonyKind, opts?: { method?: TwoFaSetupMethod }) => void;
	}

	let { s, set, launch }: Props = $props();

	const recoverySet = $derived(auth.recoveryEnabled === true);

	$effect(() => {
		if (auth.accountId && twofactor.status === null && !twofactor.loading) {
			void twofactor.load();
		}
	});

	type ProofAction =
		| { kind: 'disableTotp' }
		| { kind: 'deleteKey'; id: string; name: string }
		| { kind: 'regenCodes' };

	let proofAction = $state<ProofAction | null>(null);
	let newCodes = $state<string[] | null>(null);

	const tfStatus = $derived(twofactor.status);
	const proofMethods = $derived.by<TwoFactorMethod[]>(() => {
		const st = twofactor.status;
		if (!st) return [];
		const methods: TwoFactorMethod[] = [];
		if (st.totp?.active) methods.push('totp');
		if (st.webauthnCredentials.length > 0) methods.push('webauthn');
		if ((st.backupCodes?.remaining ?? 0) > 0) methods.push('backupCode');
		return methods;
	});

	const proofCopy = $derived.by(() => {
		const a = proofAction;
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
			case 'regenCodes':
				return {
					title: m.settings_security_backup_regen_title(),
					desc: m.settings_security_backup_regen_desc(),
					confirmLabel: m.settings_security_backup_regen(),
					danger: false
				};
		}
	});

	async function confirmProof(proof: TwoFactorProof) {
		const a = proofAction;
		if (!a) return;
		const accountId = auth.accountId ?? undefined;
		if (a.kind === 'disableTotp') {
			await totpDisable(proof, accountId);
		} else if (a.kind === 'deleteKey') {
			await webauthnDelete(a.id, proof, accountId);
		} else {
			const res = await regenerateBackupCodes(proof, accountId);
			newCodes = res.backupCodes ?? [];
		}
		proofAction = null;
		twofactor.invalidate();
		void twofactor.load(accountId);
		void loadSecurityEvents();
	}

	function fmtDate(iso: string | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	const deviceIcons: Record<DeviceIcon, typeof Monitor> = {
		monitor: Monitor,
		smartphone: Smartphone,
		globe: Globe
	};

	const sessionClientIcon: Record<SessionClient, DeviceIcon> = {
		web: 'globe',
		mobile: 'smartphone',
		desktop: 'monitor'
	};

	const sessionClientNames: Record<SessionClient, () => string> = {
		web: () => m.settings_security_client_web(),
		mobile: () => m.settings_security_client_mobile(),
		desktop: () => m.settings_security_client_desktop()
	};

	function sessionClientName(client: SessionClient): string | undefined {
		return sessionClientNames[client]?.();
	}

	let sessions = $state<SessionInfo[] | null>(null);
	let sessionsBusy = $state(false);

	const sortedSessions = $derived.by(() => {
		const list = sessions ?? [];
		return [...list].sort((a, b) => {
			if (a.current !== b.current) return a.current ? -1 : 1;
			const ta = Date.parse(a.lastUsedAt ?? a.createdAt);
			const tb = Date.parse(b.lastUsedAt ?? b.createdAt);
			return tb - ta;
		});
	});

	async function loadSessions() {
		try {
			const res = await listSessions();
			sessions = res.sessions;
		} catch {
			sessions = sessions ?? [];
		}
	}

	$effect(() => {
		if (auth.accountId) {
			void loadSessions();
			void loadSecurityEvents();
		}
	});

	$effect(() => {
		const id = auth.accountId;
		if (!id) return;
		return keystore.subscribeAccount(id, (b) => {
			if (b.type === 'vaultChanged') {
				void loadSessions();
				void loadSecurityEvents();
			}
		});
	});

	async function signOutSession(id: string) {
		sessionsBusy = true;
		try {
			await revokeSession(id);
			await loadSessions();
			void loadSecurityEvents();
		} catch {
		} finally {
			sessionsBusy = false;
		}
	}

	async function signOutOtherSessions() {
		sessionsBusy = true;
		try {
			await revokeOtherSessions();
			await loadSessions();
			void loadSecurityEvents();
		} catch {
		} finally {
			sessionsBusy = false;
		}
	}

	function fmtRelative(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
		const min = Math.round((Date.now() - t) / 60000);
		if (min < 1) return m.settings_security_just_now();
		if (min < 60) return rtf.format(-min, 'minute');
		const hours = Math.round(min / 60);
		if (hours < 24) return rtf.format(-hours, 'hour');
		return rtf.format(-Math.round(hours / 24), 'day');
	}

	function sessionMeta(s: SessionInfo): string {
		const parts = [m.settings_security_session_signed_in({ date: fmtDate(s.createdAt) })];
		if (s.current) {
			parts.push(m.settings_security_session_current());
		} else if (s.lastUsedAt) {
			parts.push(m.settings_security_session_last_active({ when: fmtRelative(s.lastUsedAt) }));
		}
		return parts.join(' · ');
	}

	const SECURITY_LOG_PAGE = 15;

	let secEvents = $state<SecurityEventInfo[] | null>(null);
	let secNextCursor = $state<string | null>(null);
	let secLoadingMore = $state(false);

	async function loadSecurityEvents() {
		try {
			const res = await listSecurityEvents({ limit: SECURITY_LOG_PAGE });
			secEvents = res.events;
			secNextCursor = res.nextCursor ?? null;
		} catch {
			secEvents = secEvents ?? [];
		}
	}

	async function loadMoreSecurityEvents() {
		const cursor = secNextCursor;
		if (!cursor || secLoadingMore) return;
		secLoadingMore = true;
		try {
			const res = await listSecurityEvents({ limit: SECURITY_LOG_PAGE, cursor });
			secEvents = [...(secEvents ?? []), ...res.events];
			secNextCursor = res.nextCursor ?? null;
		} catch {
		} finally {
			secLoadingMore = false;
		}
	}

	const securityActionMeta: Record<SecurityEventAction, { icon: typeof LogIn; label: () => string }> = {
		signed_in: { icon: LogIn, label: () => m.settings_security_log_signed_in() },
		signed_out: { icon: LogOut, label: () => m.settings_security_log_signed_out() },
		session_revoked: { icon: LogOut, label: () => m.settings_security_log_session_revoked() },
		other_sessions_revoked: { icon: LogOut, label: () => m.settings_security_log_other_sessions_revoked() },
		password_changed: { icon: KeyRound, label: () => m.settings_security_log_password_changed() },
		recovery_phrase_set: { icon: LifeBuoy, label: () => m.settings_security_log_recovery_phrase_set() },
		account_recovered: { icon: LifeBuoy, label: () => m.settings_security_log_account_recovered() },
		totp_enabled: { icon: ShieldCheckIcon, label: () => m.settings_security_log_totp_enabled() },
		totp_disabled: { icon: ShieldOff, label: () => m.settings_security_log_totp_disabled() },
		webauthn_added: { icon: Usb, label: () => m.settings_security_log_webauthn_added() },
		webauthn_removed: { icon: Usb, label: () => m.settings_security_log_webauthn_removed() },
		backup_codes_regenerated: { icon: RefreshCw, label: () => m.settings_security_log_backup_codes_regenerated() },
		account_deletion_requested: { icon: TriangleAlert, label: () => m.settings_security_log_account_deletion_requested() },
		account_deletion_canceled: { icon: ShieldCheckIcon, label: () => m.settings_security_log_account_deletion_canceled() }
	};

	function securityEventMeta(action: SecurityEventAction): { icon: typeof LogIn; label: string } {
		const meta = securityActionMeta[action];
		return meta
			? { icon: meta.icon, label: meta.label() }
			: { icon: ScrollText, label: action.replaceAll('_', ' ') };
	}

	function keyMeta(cred: { createdAt?: string; lastUsedAt?: string | null; backupState?: boolean }): string {
		const parts = [m.settings_security_key_added({ date: fmtDate(cred.createdAt) })];
		if (cred.lastUsedAt) parts.push(m.settings_security_key_last_used({ date: fmtDate(cred.lastUsedAt) }));
		if (cred.backupState) parts.push(m.settings_security_key_synced());
		return parts.join(' · ');
	}

	function fmtWhen(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		if (Date.now() - t < 7 * 24 * 60 * 60 * 1000) return fmtRelative(iso);
		return fmtDate(iso);
	}
</script>

<SecHead desc={m.settings_security_desc()} />

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet turnOnLink(t: string)}<button type="button" class="notelink" onclick={() => launch('twofa')}>{t}</button>{/snippet}

<div class="recovery-hero" class:done={recoverySet}>
	<div class="rh-left">
		<span class="rh-ic">
			{#if recoverySet}<ShieldCheckIcon size={26} />{:else}<LifeBuoy size={26} />{/if}
		</span>
	</div>
	<div class="rh-body">
		<div class="rh-eyebrow">
			{recoverySet ? m.settings_security_recovery_configured() : m.settings_security_recovery_recommended()}
		</div>
		<h3 class="rh-title">{m.settings_security_recovery_title()}</h3>
		<p class="rh-desc">
			<Rich
				text={recoverySet
					? m.settings_security_recovery_desc_set()
					: m.settings_security_recovery_desc_unset()}
				tags={{ b: bold }}
			/>
		</p>
		<div class="rh-acts">
			<Button variant="primary" onclick={() => launch('recovery')}>
				{#if recoverySet}<RefreshCw size={15} />{:else}<KeyRound size={15} />{/if}
				{recoverySet ? m.settings_security_recovery_regenerate() : m.settings_security_recovery_setup()}
			</Button>
		</div>
	</div>
	{#if !recoverySet}
		<span class="rh-flag"><TriangleAlert size={13} />{m.settings_security_recovery_not_set()}</span>
	{/if}
</div>

<div class="scard">
	<CardHead icon={EyeOff} title={m.settings_security_privacy()} />
	<Row
		t={m.settings_security_remote_images()}
		d={m.settings_security_remote_images_desc()}
	>
		<span class="t-mono-xs" style="color: var(--success-700)">{m.settings_security_always_proxied()}</span>
	</Row>
	<Row
		t={m.settings_security_strip_tracking()}
		d={m.settings_security_strip_tracking_desc()}
	>
		<Toggle on={s.stripTrack} onChange={(v) => set('stripTrack', v)} />
	</Row>
	<Row
		t={m.settings_security_spam_headers()}
		d={m.settings_security_spam_headers_desc()}
	>
		<Toggle on={s.shareSpamHeaders} onChange={(v) => set('shareSpamHeaders', v)} />
	</Row>
</div>

<div class="scard flat">
	<CardHead icon={KeyRound} title={m.settings_security_signin_title()}>
		{#snippet right()}
			{#if twofactor.enabled}
				<Badge kind="ok" dot>{m.settings_security_2fa_on()}</Badge>
			{:else}
				<Badge kind="warn" dot>{m.settings_security_2fa_off()}</Badge>
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
				<Button variant="ghost" size="sm" onclick={() => (proofAction = { kind: 'disableTotp' })}>
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
	{#each tfStatus?.webauthnCredentials ?? [] as cred (cred.id)}
		<div class="tfa-row">
			<span class="tfa-ic">
				{#if cred.backupState}<Fingerprint size={18} />{:else}<Usb size={18} />{/if}
			</span>
			<div class="tfa-info">
				<div class="tfa-t">{cred.name}<Badge kind="ok">{m.settings_security_on()}</Badge></div>
				<div class="tfa-d">
					{keyMeta(cred)}
				</div>
			</div>
			<div class="tfa-act">
				<Button variant="ghost" size="sm" onclick={() => (proofAction = { kind: 'deleteKey', id: cred.id, name: cred.name })}>
					{m.common_remove()}
				</Button>
			</div>
		</div>
	{/each}
	{#if webauthnSupported()}
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
				<Button variant="ghost" size="sm" onclick={() => (proofAction = { kind: 'regenCodes' })}>
					<RefreshCw size={14} />{m.settings_security_backup_regen()}
				</Button>
			</div>
		</div>
	{:else if tfStatus}
		<div class="card-note warn">
			<TriangleAlert size={13} />
			<span>
				<Rich text={m.settings_security_2fa_off_note()} tags={{ link: turnOnLink }} />
			</span>
		</div>
	{/if}
</div>

{#if proofAction && proofCopy}
	<TwoFactorProofDialog
		title={proofCopy.title}
		desc={proofCopy.desc}
		confirmLabel={proofCopy.confirmLabel}
		danger={proofCopy.danger}
		methods={proofMethods}
		onConfirm={confirmProof}
		onClose={() => (proofAction = null)}
	/>
{/if}

{#if newCodes}
	<TwoFactorBackupCodesDialog codes={newCodes} onClose={() => (newCodes = null)} />
{/if}

<div class="scard">
	<CardHead icon={MonitorSmartphone} title={m.settings_security_sessions()} />
	{#each sortedSessions as d (d.id)}
		{@const DevIcon = deviceIcons[sessionClientIcon[d.client]]}
		<div class="devrow">
			<span class="dv-ic"><DevIcon size={18} /></span>
			<div class="dv-info">
				<div class="dv-name">
					{sessionClientName(d.client)}{#if d.current}<span class="this-dev">{m.settings_security_this_device()}</span
						>{/if}
				</div>
				<div class="dv-meta">{sessionMeta(d)}</div>
			</div>
			<div class="dv-act">
				{#if !d.current}<Button variant="ghost" size="sm" disabled={sessionsBusy} onclick={() => signOutSession(d.id)}>{m.settings_security_sign_out()}</Button>{/if}
			</div>
		</div>
	{/each}
	<div class="setrow">
		<div class="info">
			<div class="t" style:font-weight="600" style:color="var(--danger-700)">
				{m.settings_security_sign_out_others()}
			</div>
		</div>
		<div class="ctl">
			<Button variant="danger" size="sm" disabled={sessionsBusy} onclick={signOutOtherSessions}>
				<LogOut size={14} />{m.settings_security_revoke_all()}
			</Button>
		</div>
	</div>
</div>

<div class="scard">
	<CardHead icon={KeySquare} title={m.settings_security_keys_title()}>
		{#snippet right()}<Badge kind="neutral">{m.settings_security_advanced()}</Badge>{/snippet}
	</CardHead>
	<Row
		col
		t={m.settings_security_fingerprint()}
		d={m.settings_security_fingerprint_desc()}
	>
		<div class="codeblock">
			<span class="v">4F2A 9C71 B0E3 5D88 · 19FE 4B0C 2D71 88AC</span>
			<button type="button" class="cp" title={m.common_copy()}><Copy size={15} /></button>
		</div>
	</Row>
	<div class="cer-rows tight">
		<CeremonyRow
			icon={RefreshCw}
			title={m.settings_security_rotate_title()}
			desc={m.settings_security_rotate_desc()}
			cta={m.settings_security_rotate_cta()}
			onLaunch={() => launch('keys')}
		/>
	</div>
	<div class="setrow">
		<div class="info">
			<div class="t">{m.settings_security_import_export()}</div>
			<div class="d">{m.settings_security_import_export_desc()}</div>
		</div>
		<div class="ctl">
			<Button variant="secondary" size="sm">
				<Upload size={14} />{m.settings_security_import()}
			</Button>
			<Button variant="secondary" size="sm">
				<Download size={14} />{m.settings_security_export_key()}
			</Button>
		</div>
	</div>
</div>

<div class="scard">
	<CardHead icon={ScrollText} title={m.settings_security_log()} />
	<div class="log-list">
		{#if secEvents && secEvents.length === 0}
			<div class="log-row">
				<span class="log-ic"><ScrollText size={15} /></span>
				<div class="log-info">
					<div class="log-t">{m.settings_security_log_empty()}</div>
					<div class="log-meta">{m.settings_security_log_empty_desc()}</div>
				</div>
			</div>
		{/if}
		{#each secEvents ?? [] as e (e.id)}
			{@const meta = securityEventMeta(e.action)}
			{@const Ic = meta.icon}
			<div class="log-row">
				<span class="log-ic"><Ic size={15} /></span>
				<div class="log-info">
					<div class="log-t">{meta.label}</div>
					<div class="log-meta">{sessionClientName(e.client) ?? e.client}</div>
				</div>
				<span class="log-when">{fmtWhen(e.occurredAt)}</span>
			</div>
		{/each}
		{#if secNextCursor}
			<div class="log-row" style:justify-content="center">
				<Button variant="ghost" size="sm" disabled={secLoadingMore} onclick={loadMoreSecurityEvents}>
					{m.settings_security_show_more()}
				</Button>
			</div>
		{/if}
	</div>
</div>

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
