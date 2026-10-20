<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { untrack } from 'svelte';
	import Card from '../Card.svelte';
	import LoadState from './LoadState.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import { timeSince } from '$core/i18n/relative';
	import { auth } from '$core/stores/auth.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { listSessions, revokeSession, revokeOtherSessions } from '$core/api/auth';
	import type { SessionInfo } from '$core/api/types';
	import { fmtDate, sessionClientIcon, sessionClientName } from './format';
	import { securityActivity } from './activity.svelte';
	import { securityActionError } from './errors';

	let sessions = $state<SessionInfo[] | null>(null);
	let loading = $state(false);
	let loadFailed = $state(false);
	let busy = $state(false);
	let actionError = $state<string | null>(null);
	let confirmAll = $state(false);
	let seq = 0;

	const sortedSessions = $derived.by(() => {
		const list = sessions ?? [];
		return [...list].sort((a, b) => {
			if (a.current !== b.current) return a.current ? -1 : 1;
			const ta = Date.parse(a.lastUsedAt ?? a.createdAt);
			const tb = Date.parse(b.lastUsedAt ?? b.createdAt);
			return tb - ta;
		});
	});

	const hasOthers = $derived((sessions ?? []).some((s) => !s.current));

	async function loadSessions() {
		const mine = ++seq;
		loading = true;
		try {
			const res = await listSessions();
			if (mine !== seq) return;
			sessions = res.sessions;
			loadFailed = false;
		} catch {
			if (mine !== seq) return;
			loadFailed = true;
		} finally {
			if (mine === seq) loading = false;
		}
	}

	$effect(() => {
		if (!auth.accountId) return;
		sessions = null;
		loadFailed = false;
		actionError = null;
		void loadSessions();
	});

	let primed = false;
	$effect(() => {
		void auth.sessionRotations;
		if (!primed) {
			primed = true;
			return;
		}
		if (untrack(() => auth.accountId)) void loadSessions();
	});

	$effect(() => {
		const id = auth.accountId;
		if (!id) return;
		return keystore.subscribeAccount(id, (b) => {
			if (b.type === 'vaultChanged') void loadSessions();
		});
	});

	async function signOutSession(id: string) {
		busy = true;
		actionError = null;
		try {
			await revokeSession(id);
			securityActivity.touch();
			await loadSessions();
		} catch (err) {
			if (!isReauthenticationRequired(err)) {
				actionError = securityActionError(err, m.settings_security_session_revoke_failed);
			}
		} finally {
			busy = false;
		}
	}

	async function signOutOtherSessions() {
		busy = true;
		actionError = null;
		try {
			await revokeOtherSessions();
			confirmAll = false;
			securityActivity.touch();
			await loadSessions();
		} catch (err) {
			confirmAll = false;
			if (!isReauthenticationRequired(err)) {
				actionError = securityActionError(err, m.settings_security_revoke_all_failed);
			}
		} finally {
			busy = false;
		}
	}

	function sessionMeta(s: SessionInfo): string {
		const parts = [m.settings_security_session_signed_in({ date: fmtDate(s.createdAt) })];
		if (s.current) {
			parts.push(m.settings_security_session_current());
		} else if (s.lastUsedAt) {
			parts.push(m.settings_security_session_last_active({ when: timeSince(s.lastUsedAt) }));
		}
		return parts.join(' · ');
	}
</script>

<Card icon={MonitorSmartphone} title={m.settings_security_sessions()}>
	{#if sessions === null}
		{#if loadFailed}
			<LoadState
				kind="error"
				label={m.settings_security_sessions_load_failed()}
				retrying={loading}
				onRetry={() => void loadSessions()}
			/>
		{:else}
			<LoadState kind="loading" label={m.settings_security_sessions_loading()} />
		{/if}
	{:else}
		{#if loadFailed}
			<LoadState
				kind="error"
				label={m.settings_security_sessions_refresh_failed()}
				retrying={loading}
				onRetry={() => void loadSessions()}
			/>
		{/if}
		{#if actionError}
			<LoadState kind="error" label={actionError} />
		{/if}
		{#each sortedSessions as d (d.id)}
			{@const DevIcon = sessionClientIcon[d.client]}
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
					{#if !d.current}<Button variant="ghost" size="sm" disabled={busy} onclick={() => signOutSession(d.id)}
							>{m.settings_security_sign_out()}</Button
						>{/if}
				</div>
			</div>
		{/each}
		{#if hasOthers}
			<div class="setrow">
				<div class="info">
					<div class="t" style:font-weight="600" style:color="var(--danger-700)">
						{m.settings_security_sign_out_others()}
					</div>
				</div>
				<div class="ctl">
					<Button variant="danger" size="sm" disabled={busy} onclick={() => (confirmAll = true)}>
						<LogOut size={14} />{m.settings_security_revoke_all()}
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</Card>

{#snippet revokeAllBody()}<p class="cfd-p">{m.settings_security_revoke_all_desc()}</p>{/snippet}

{#if confirmAll}
	<ConfirmDialog
		icon={LogOut}
		tone="danger"
		title={m.settings_security_revoke_all_title()}
		body={revokeAllBody}
		confirmLabel={m.settings_security_revoke_all_confirm()}
		{busy}
		onConfirm={() => void signOutOtherSessions()}
		onClose={() => {
			if (!busy) confirmAll = false;
		}}
	/>
{/if}
