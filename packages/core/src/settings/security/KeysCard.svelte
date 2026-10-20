<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import KeySquare from '@lucide/svelte/icons/key-square';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Download from '@lucide/svelte/icons/download';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';
	import Badge from '../Badge.svelte';
	import CeremonyRow from '../CeremonyRow.svelte';
	import CopyBtn from '../CopyBtn.svelte';
	import { Button } from '$core/components/ui/button';
	import { accountKeys } from '$core/stores/accountKeys.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { formatFingerprintHex, formatKeyId } from '$core/directory/format';
	import { platform } from '$platform';
	import type { CeremonyKind } from '../data';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	const ownKey = $derived(accountKeys.current);
	const earlierKeys = $derived(accountKeys.history);

	$effect(() => {
		if (auth.accountId) void accountKeys.ready(auth.accountId);
	});

	const rotationBlocker = $derived(
		accountKeys.authScheme === 'srp_v1'
			? 'sign_in_upgrade_required'
			: auth.accountId
				? auth.keyRotationBlockerFor(auth.accountId)
				: null
	);

	async function exportPublicKey() {
		if (!ownKey) return;
		const blob = new Blob([ownKey.publicKeyArmored], { type: 'application/pgp-keys' });
		await platform.saveBlob(blob, `${auth.email ?? 'thelemail'}.asc`);
	}
</script>

<Card icon={KeySquare} title={m.settings_security_keys_title()}>
	{#snippet right()}<Badge kind="neutral">{m.settings_security_advanced()}</Badge>{/snippet}
	{#if (accountKeys.verification === 'unverified' || accountKeys.verification === 'unreachable') && auth.accountId}
		{@const accountId = auth.accountId}
		{@const mismatch = accountKeys.verification === 'unverified'}
		<div class="key-unverified" role="alert">
			<TriangleAlert size={16} />
			<div class="key-unverified-body">
				<div class="key-unverified-t">
					{mismatch ? m.settings_security_key_unverified_title() : m.settings_security_key_unchecked_title()}
				</div>
				<p>{mismatch ? m.settings_security_key_unverified() : m.settings_security_key_unchecked()}</p>
				<Button variant="secondary" size="sm" onclick={() => accountKeys.load(accountId)}>{m.common_retry()}</Button>
			</div>
		</div>
	{/if}
	<Row
		col
		t={m.settings_security_fingerprint()}
		d={m.settings_security_fingerprint_desc()}
	>
		{#if ownKey}
			<div class="codeblock">
				<span class="v">{formatFingerprintHex(ownKey.fingerprintHex)}</span>
				<CopyBtn text={ownKey.fingerprintHex} small />
			</div>
			<div class="key-meta">
				{m.settings_security_key_version({ version: String(ownKey.keyVersion) })}
			</div>
			{#if earlierKeys.length}
				<div class="key-meta">
					{m.settings_security_earlier_keys()}
					{#each earlierKeys as k (k.fingerprintHex)}
						<span class="key-earlier">v{k.keyVersion} · {formatKeyId(k.fingerprintHex)}</span>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="key-meta">{m.settings_security_fingerprint_locked()}</div>
		{/if}
		{#if accountKeys.error && auth.accountId}
			{@const accountId = auth.accountId}
			<div class="key-meta key-warn">
				<span>{m.settings_security_keys_incomplete()}</span>
				<Button variant="ghost" size="sm" onclick={() => accountKeys.load(accountId)}>{m.common_retry()}</Button>
			</div>
		{/if}
	</Row>
	<div class="cer-rows tight">
		{#if rotationBlocker}
			<div class="setrow">
				<div class="info">
					<div class="t">{m.settings_security_rotate_title()}</div>
					<div class="d">
						{rotationBlocker === 'recovery_upgrade_required'
							? m.settings_security_rotate_blocked_recovery()
							: m.settings_security_rotate_blocked_sign_in()}
					</div>
				</div>
			</div>
		{:else}
			<CeremonyRow
				icon={RefreshCw}
				title={m.settings_security_rotate_title()}
				desc={m.settings_security_rotate_desc()}
				cta={m.settings_security_rotate_cta()}
				onLaunch={() => launch('keys')}
			/>
		{/if}
	</div>
	<Row t={m.settings_security_export_title()} d={m.settings_security_export_desc()}>
		<Button variant="secondary" size="sm" disabled={!ownKey} onclick={exportPublicKey}>
			<Download size={14} />{m.settings_security_export_key()}
		</Button>
	</Row>
</Card>

<style>
	.key-meta {
		margin-top: 6px;
		font-size: 12.5px;
		color: var(--ink-600);
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
	}

	.key-earlier {
		font-family: var(--font-mono);
		color: var(--ink-700);
	}

	.key-warn {
		align-items: center;
		color: var(--warning-700);
	}

	.key-unverified {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border);
		background: var(--danger-100);
		color: var(--danger-700);
		font-size: 13px;
		line-height: 1.5;
	}

	.key-unverified :global(svg) {
		flex: 0 0 auto;
		margin-top: 2px;
	}

	.key-unverified-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}

	.key-unverified-t {
		font-weight: 600;
	}

	.key-unverified p {
		margin: 0;
	}
</style>
