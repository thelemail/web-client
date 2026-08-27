<script lang="ts">
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
	import { auth } from '$lib/stores/auth.svelte';
	import { twofactor } from '$lib/stores/twofactor.svelte';
	import {
		regenerateBackupCodes,
		totpDisable,
		webauthnDelete
	} from '$lib/api/twofactor';
	import { listSessions, listSecurityEvents, revokeSession, revokeOtherSessions } from '$lib/api/auth';
	import type {
		SecurityEventAction,
		SecurityEventInfo,
		SessionClient,
		SessionInfo,
		TwoFactorMethod,
		TwoFactorProof
	} from '$lib/api/types';
	import { webauthnSupported } from '$lib/auth/webauthn';
	import { keystore } from '$lib/keystore/keystore-client';
	import TwoFactorProofDialog from '../TwoFactorProofDialog.svelte';
	import TwoFactorBackupCodesDialog from '../TwoFactorBackupCodesDialog.svelte';
	import type { SettingsState, CeremonyKind, TwoFaSetupMethod } from '../data';

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
					title: 'Remove authenticator app',
					desc:
						methodCount <= 1
							? 'This is your last second factor — removing it turns two-factor authentication off and discards your backup codes.'
							: 'Codes from your authenticator app will stop working at sign-in.',
					confirmLabel: 'Remove authenticator',
					danger: true
				};
			case 'deleteKey':
				return {
					title: `Remove “${a.name}”`,
					desc:
						methodCount <= 1
							? 'This is your last second factor — removing it turns two-factor authentication off and discards your backup codes.'
							: 'This key will no longer work at sign-in.',
					confirmLabel: 'Remove key',
					danger: true
				};
			case 'regenCodes':
				return {
					title: 'Regenerate backup codes',
					desc: 'All current backup codes stop working immediately and a fresh set of ten is issued.',
					confirmLabel: 'Regenerate',
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

	const sessionClientName: Record<SessionClient, string> = {
		web: 'Web client',
		mobile: 'Mobile app',
		desktop: 'Desktop app'
	};

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
		if (min < 1) return 'just now';
		if (min < 60) return rtf.format(-min, 'minute');
		const hours = Math.round(min / 60);
		if (hours < 24) return rtf.format(-hours, 'hour');
		return rtf.format(-Math.round(hours / 24), 'day');
	}

	function sessionMeta(s: SessionInfo): string {
		const parts = [`Signed in ${fmtDate(s.createdAt)}`];
		if (s.current) {
			parts.push('current session');
		} else if (s.lastUsedAt) {
			parts.push(`last active ${fmtRelative(s.lastUsedAt)}`);
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

	const securityActionMeta: Record<SecurityEventAction, { icon: typeof LogIn; label: string }> = {
		signed_in: { icon: LogIn, label: 'Signed in' },
		signed_out: { icon: LogOut, label: 'Signed out' },
		session_revoked: { icon: LogOut, label: 'Session signed out' },
		other_sessions_revoked: { icon: LogOut, label: 'Signed out other sessions' },
		password_changed: { icon: KeyRound, label: 'Password changed' },
		recovery_phrase_set: { icon: LifeBuoy, label: 'Recovery phrase set' },
		account_recovered: { icon: LifeBuoy, label: 'Account recovered' },
		totp_enabled: { icon: ShieldCheckIcon, label: 'Authenticator app added' },
		totp_disabled: { icon: ShieldOff, label: 'Authenticator app removed' },
		webauthn_added: { icon: Usb, label: 'Security key added' },
		webauthn_removed: { icon: Usb, label: 'Security key removed' },
		backup_codes_regenerated: { icon: RefreshCw, label: 'Backup codes regenerated' },
		account_deletion_requested: { icon: TriangleAlert, label: 'Account deletion requested' },
		account_deletion_canceled: { icon: ShieldCheckIcon, label: 'Account deletion canceled' }
	};

	function securityEventMeta(action: SecurityEventAction): { icon: typeof LogIn; label: string } {
		return securityActionMeta[action] ?? { icon: ScrollText, label: action.replaceAll('_', ' ') };
	}

	function fmtWhen(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		if (Date.now() - t < 7 * 24 * 60 * 60 * 1000) return fmtRelative(iso);
		return fmtDate(iso);
	}
</script>

<SecHead
	tag="05 — Security & privacy"
	title="Security & privacy"
	desc="Specific, honest controls. We name the mechanism and tell you what we do and don’t do. The marked steps change key material — treat them with care."
/>

<div class="recovery-hero" class:done={recoverySet}>
	<div class="rh-left">
		<span class="rh-ic">
			{#if recoverySet}<ShieldCheckIcon size={26} />{:else}<LifeBuoy size={26} />{/if}
		</span>
	</div>
	<div class="rh-body">
		<div class="rh-eyebrow">
			{recoverySet ? 'Recovery configured' : 'Action recommended'}
		</div>
		<h3 class="rh-title">Account recovery</h3>
		<p class="rh-desc">
			Thelemail is zero-access encrypted — we cannot read your mail, and we cannot reset it for
			you. A recovery phrase is the <b>only</b> way back into your archive if you forget your
			password.
			{recoverySet
				? ' Yours is set. Keep the phrase somewhere safe and offline.'
				: ' Without it, a forgotten password means the mail is gone for good.'}
		</p>
		<div class="rh-acts">
			<button type="button" class="btn btn-primary" onclick={() => launch('recovery')}>
				{#if recoverySet}<RefreshCw size={15} />{:else}<KeyRound size={15} />{/if}
				{recoverySet ? 'Regenerate recovery phrase' : 'Set up recovery'}
			</button>
		</div>
	</div>
	{#if !recoverySet}
		<span class="rh-flag"><TriangleAlert size={13} />Not set up</span>
	{/if}
</div>

<div class="scard">
	<CardHead icon={EyeOff} title="Privacy" />
	<Row
		t="Remote images"
		d="Every image in incoming mail is downloaded by our server at delivery and stored encrypted alongside the message. Senders never see when, or whether, you open an email."
	>
		<span class="t-mono-xs" style="color: var(--success-700)">Always proxied</span>
	</Row>
	<Row
		t="Strip tracking links"
		d="Removes utm_*, fbclid, gclid and other tracking parameters from links before you click."
	>
		<Toggle on={s.stripTrack} onChange={(v) => set('stripTrack', v)} />
	</Row>
</div>

<div class="scard flat">
	<CardHead icon={KeyRound} title="Sign-in & authentication">
		{#snippet right()}
			{#if twofactor.enabled}
				<Badge kind="ok" dot>2FA on</Badge>
			{:else}
				<Badge kind="warn" dot>2FA off</Badge>
			{/if}
		{/snippet}
	</CardHead>
	<div class="cer-rows">
		<CeremonyRow
			icon={Lock}
			title="Change password"
			desc="Re-wraps your private key, so this is more than a credential swap."
			cta="Change"
			onLaunch={() => launch('password')}
		/>
	</div>
	<div class="tfa-sub">
		<ShieldCheckIcon size={13} />Two-factor methods
		<span class="tfa-sub-note">any enrolled method works at sign-in</span>
	</div>
	{#if tfStatus?.totp?.active}
		<div class="tfa-row">
			<span class="tfa-ic"><Smartphone size={18} /></span>
			<div class="tfa-info">
				<div class="tfa-t">Authenticator app<Badge kind="ok">On</Badge></div>
				<div class="tfa-d">
					Codes from your authenticator · added {fmtDate(tfStatus.totp.createdAt)}
				</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => (proofAction = { kind: 'disableTotp' })}
				>
					Remove
				</button>
			</div>
		</div>
	{:else}
		<div class="tfa-row off">
			<span class="tfa-ic"><Smartphone size={18} /></span>
			<div class="tfa-info">
				<div class="tfa-t">Authenticator app</div>
				<div class="tfa-d">6-digit codes from an app like Aegis or 1Password.</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => launch('twofa', { method: 'totp' })}
				>
					<Plus size={14} />Set up
				</button>
			</div>
		</div>
	{/if}
	{#each tfStatus?.webauthnCredentials ?? [] as cred (cred.id)}
		<div class="tfa-row">
			<span class="tfa-ic">
				{#if cred.backupState}<Fingerprint size={18} />{:else}<Usb size={18} />{/if}
			</span>
			<div class="tfa-info">
				<div class="tfa-t">{cred.name}<Badge kind="ok">On</Badge></div>
				<div class="tfa-d">
					Added {fmtDate(cred.createdAt)}{cred.lastUsedAt
						? ' · last used ' + fmtDate(cred.lastUsedAt)
						: ''}{cred.backupState ? ' · synced passkey' : ''}
				</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => (proofAction = { kind: 'deleteKey', id: cred.id, name: cred.name })}
				>
					Remove
				</button>
			</div>
		</div>
	{/each}
	{#if webauthnSupported()}
		<div class="tfa-row off">
			<span class="tfa-ic"><Usb size={18} /></span>
			<div class="tfa-info">
				<div class="tfa-t">Security key</div>
				<div class="tfa-d">A YubiKey or any FIDO2 hardware key, via WebAuthn.</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => launch('twofa', { method: 'key' })}
				>
					<Plus size={14} />Set up
				</button>
			</div>
		</div>
		<div class="tfa-row off">
			<span class="tfa-ic"><Fingerprint size={18} /></span>
			<div class="tfa-info">
				<div class="tfa-t">This device</div>
				<div class="tfa-d">Touch ID, Face ID, or your screen lock — a passkey kept on this device.</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => launch('twofa', { method: 'device' })}
				>
					<Plus size={14} />Set up
				</button>
			</div>
		</div>
	{/if}
	{#if tfStatus?.enabled}
		<div class="tfa-row backup">
			<span class="tfa-ic"><LifeBuoy size={18} /></span>
			<div class="tfa-info">
				<div class="tfa-t">Backup codes</div>
				<div class="tfa-d">
					{tfStatus.backupCodes?.remaining ?? 0} unused · each opens the door once if you lose every
					method above.
				</div>
			</div>
			<div class="tfa-act">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => (proofAction = { kind: 'regenCodes' })}
				>
					<RefreshCw size={14} />Regenerate
				</button>
			</div>
		</div>
	{:else if tfStatus}
		<div class="card-note warn">
			<TriangleAlert size={13} />
			<span>
				Two-factor is off &mdash; your password is the only thing at the door.
				<button type="button" class="notelink" onclick={() => launch('twofa')}>Turn it on</button>.
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
	<CardHead icon={MonitorSmartphone} title="Active sessions" />
	{#each sortedSessions as d (d.id)}
		{@const DevIcon = deviceIcons[sessionClientIcon[d.client]]}
		<div class="devrow">
			<span class="dv-ic"><DevIcon size={18} /></span>
			<div class="dv-info">
				<div class="dv-name">
					{sessionClientName[d.client]}{#if d.current}<span class="this-dev">This device</span
						>{/if}
				</div>
				<div class="dv-meta">{sessionMeta(d)}</div>
			</div>
			<div class="dv-act">
				{#if !d.current}<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={sessionsBusy}
						onclick={() => signOutSession(d.id)}>Sign out</button
					>{/if}
			</div>
		</div>
	{/each}
	<div class="setrow">
		<div class="info">
			<div class="t" style:font-weight="600" style:color="var(--danger-700)">
				Sign out everywhere else
			</div>
		</div>
		<div class="ctl">
			<button
				type="button"
				class="btn btn-danger btn-sm"
				disabled={sessionsBusy}
				onclick={signOutOtherSessions}
			>
				<LogOut size={14} />Revoke all
			</button>
		</div>
	</div>
</div>

<div class="scard">
	<CardHead icon={KeySquare} title="Encryption keys">
		{#snippet right()}<Badge kind="neutral">Advanced</Badge>{/snippet}
	</CardHead>
	<Row
		col
		t="Your key fingerprint"
		d="Share this out-of-band so others can verify they’re really writing to you."
	>
		<div class="codeblock">
			<span class="v">4F2A 9C71 B0E3 5D88 · 19FE 4B0C 2D71 88AC</span>
			<button type="button" class="cp" title="Copy"><Copy size={15} /></button>
		</div>
	</Row>
	<div class="cer-rows tight">
		<CeremonyRow
			icon={RefreshCw}
			title="Rotate your key"
			desc="Issues a new keypair and re-encrypts your archive. Old mail stays readable."
			cta="Rotate"
			onLaunch={() => launch('keys')}
		/>
	</div>
	<div class="setrow">
		<div class="info">
			<div class="t">Import &amp; export</div>
			<div class="d">Bring in contacts’ public keys, or export your own.</div>
		</div>
		<div class="ctl">
			<button type="button" class="btn btn-secondary btn-sm">
				<Upload size={14} />Import
			</button>
			<button type="button" class="btn btn-secondary btn-sm">
				<Download size={14} />Export public key
			</button>
		</div>
	</div>
</div>

<div class="scard">
	<CardHead icon={ScrollText} title="Security log" />
	<div class="log-list">
		{#if secEvents && secEvents.length === 0}
			<div class="log-row">
				<span class="log-ic"><ScrollText size={15} /></span>
				<div class="log-info">
					<div class="log-t">No security events yet</div>
					<div class="log-meta">Sign-ins and account changes will appear here.</div>
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
					<div class="log-meta">{sessionClientName[e.client] ?? e.client}</div>
				</div>
				<span class="log-when">{fmtWhen(e.occurredAt)}</span>
			</div>
		{/each}
		{#if secNextCursor}
			<div class="log-row" style:justify-content="center">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					disabled={secLoadingMore}
					onclick={loadMoreSecurityEvents}
				>
					Show more
				</button>
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
