<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import LogOut from '@lucide/svelte/icons/log-out';
	import CardHead from '../CardHead.svelte';
	import { Button } from '$core/components/ui/button';
	import { timeSince } from '$core/i18n/relative';
	import { auth } from '$core/stores/auth.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import { listSessions, revokeSession, revokeOtherSessions } from '$core/api/auth';
	import type { SessionInfo } from '$core/api/types';
	import { fmtDate, sessionClientIcon, sessionClientName } from './format';
	import { securityActivity } from './activity.svelte';

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
		if (auth.accountId) void loadSessions();
	});

	$effect(() => {
		if (auth.accountId && auth.sessionRotations > 0) void loadSessions();
	});

	$effect(() => {
		const id = auth.accountId;
		if (!id) return;
		return keystore.subscribeAccount(id, (b) => {
			if (b.type === 'vaultChanged') void loadSessions();
		});
	});

	async function signOutSession(id: string) {
		sessionsBusy = true;
		try {
			await revokeSession(id);
			await loadSessions();
			securityActivity.touch();
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
			securityActivity.touch();
		} catch {
		} finally {
			sessionsBusy = false;
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

<div class="scard">
	<CardHead icon={MonitorSmartphone} title={m.settings_security_sessions()} />
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
