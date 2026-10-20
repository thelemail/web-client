<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Usb from '@lucide/svelte/icons/usb';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import LogIn from '@lucide/svelte/icons/log-in';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import { untrack } from 'svelte';
	import CardHead from '../CardHead.svelte';
	import LoadState from './LoadState.svelte';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { securityActionError } from './errors';
	import { Button } from '$core/components/ui/button';
	import { timeSince } from '$core/i18n/relative';
	import { serverNow } from '$core/api/serverclock';
	import { auth } from '$core/stores/auth.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import { listSecurityEvents } from '$core/api/auth';
	import type { SecurityEventAction, SecurityEventInfo } from '$core/api/types';
	import { fmtDate, sessionClientName } from './format';
	import { securityActivity } from './activity.svelte';

	const SECURITY_LOG_PAGE = 15;

	let secEvents = $state<SecurityEventInfo[] | null>(null);
	let secNextCursor = $state<string | null>(null);
	let secLoading = $state(false);
	let secLoadFailed = $state(false);
	let secLoadingMore = $state(false);
	let moreError = $state<string | null>(null);
	let seq = 0;

	async function loadSecurityEvents() {
		const mine = ++seq;
		secLoading = true;
		try {
			const res = await listSecurityEvents({ limit: SECURITY_LOG_PAGE });
			if (mine !== seq) return;
			secEvents = res.events;
			secNextCursor = res.nextCursor ?? null;
			secLoadFailed = false;
			moreError = null;
		} catch {
			if (mine !== seq) return;
			secLoadFailed = true;
		} finally {
			if (mine === seq) secLoading = false;
		}
	}

	async function loadMoreSecurityEvents() {
		const cursor = secNextCursor;
		if (!cursor || secLoadingMore) return;
		const mine = seq;
		secLoadingMore = true;
		moreError = null;
		try {
			const res = await listSecurityEvents({ limit: SECURITY_LOG_PAGE, cursor });
			if (mine !== seq) return;
			secEvents = [...(secEvents ?? []), ...res.events];
			secNextCursor = res.nextCursor ?? null;
		} catch (err) {
			if (mine !== seq || isReauthenticationRequired(err)) return;
			moreError = securityActionError(err, m.settings_security_log_more_failed);
		} finally {
			secLoadingMore = false;
		}
	}

	$effect(() => {
		if (!auth.accountId) return;
		secEvents = null;
		secNextCursor = null;
		secLoadFailed = false;
		moreError = null;
		void loadSecurityEvents();
	});

	let primed = false;
	$effect(() => {
		void auth.sessionRotations;
		void securityActivity.version;
		if (!primed) {
			primed = true;
			return;
		}
		if (untrack(() => auth.accountId)) void loadSecurityEvents();
	});

	$effect(() => {
		const id = auth.accountId;
		if (!id) return;
		return keystore.subscribeAccount(id, (b) => {
			if (b.type === 'vaultChanged') void loadSecurityEvents();
		});
	});

	const securityActionMeta: Record<SecurityEventAction, { icon: typeof LogIn; label: () => string }> = {
		signed_in: { icon: LogIn, label: () => m.settings_security_log_signed_in() },
		signed_out: { icon: LogOut, label: () => m.settings_security_log_signed_out() },
		session_revoked: { icon: LogOut, label: () => m.settings_security_log_session_revoked() },
		other_sessions_revoked: { icon: LogOut, label: () => m.settings_security_log_other_sessions_revoked() },
		session_reuse_detected: { icon: TriangleAlert, label: () => m.settings_security_log_session_reuse_detected() },
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

	function fmtWhen(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		if (serverNow() - t < 7 * 24 * 60 * 60 * 1000) return timeSince(iso);
		return fmtDate(iso);
	}
</script>

<div class="scard">
	<CardHead icon={ScrollText} title={m.settings_security_log()} />
	{#if secEvents === null}
		{#if secLoadFailed}
			<LoadState
				kind="error"
				label={m.settings_security_log_load_failed()}
				retrying={secLoading}
				onRetry={() => void loadSecurityEvents()}
			/>
		{:else}
			<LoadState kind="loading" rows={3} label={m.settings_security_log_loading()} />
		{/if}
	{:else}
		{#if secLoadFailed}
			<LoadState
				kind="error"
				label={m.settings_security_log_refresh_failed()}
				retrying={secLoading}
				onRetry={() => void loadSecurityEvents()}
			/>
		{/if}
		<div class="log-list">
			{#if secEvents.length === 0}
				<div class="log-row">
					<span class="log-ic"><ScrollText size={15} /></span>
					<div class="log-info">
						<div class="log-t">{m.settings_security_log_empty()}</div>
						<div class="log-meta">{m.settings_security_log_empty_desc()}</div>
					</div>
				</div>
			{/if}
			{#each secEvents as e (e.id)}
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
		</div>
		{#if moreError}
			<LoadState kind="error" label={moreError} />
		{/if}
		{#if secNextCursor}
			<div class="log-more">
				<Button variant="ghost" size="sm" disabled={secLoadingMore} onclick={loadMoreSecurityEvents}>
					{m.settings_security_show_more()}
				</Button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.log-more {
		display: flex;
		justify-content: center;
		padding: 6px 18px 10px;
		border-top: 1px dashed var(--border);
	}
</style>
