<script lang="ts">
	import { platform } from '$platform';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import KeyRound from '@lucide/svelte/icons/key-round';

	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import CeremonyShell from '../CeremonyShell.svelte';
	import Seg from '../Seg.svelte';
	import { Button } from '$core/components/ui/button';
	import { auth } from '$core/stores/auth.svelte';
	import { delegations } from '$core/stores/delegations.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import type { AccountAddress } from '$core/api/addresses';

	interface Props {
		address: AccountAddress;
		onClose: () => void;
	}

	let { address, onClose }: Props = $props();

	const expiryChoices = $derived([
		{ v: '90', l: m.settings_delegation_expiry_90d() },
		{ v: '365', l: m.settings_delegation_expiry_1y() },
		{ v: '730', l: m.settings_delegation_expiry_2y() }
	]);

	let step = $state(0);
	let label = $state('');
	let expiry = $state('365');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let privateKeyArmored = $state('');
	let fingerprint = $state('');
	let saved = $state(false);
	let copied = $state(false);

	const canCreate = $derived(label.trim().length > 0 && !busy);
	const fileName = $derived(
		`thelemail-signing-key-${address.email.replace(/[^a-z0-9]+/gi, '-')}.asc`
	);

	async function create() {
		if (!canCreate) return;
		const accountId = auth.accountId;
		if (!accountId) {
			error = m.settings_forwarding_sign_in_again();
			return;
		}
		busy = true;
		error = null;
		try {
			const generated = await keystore.createSigningDelegationKey({
				accountId,
				email: address.email,
				label: label.trim(),
				validForDays: Number(expiry)
			});
			if (!generated.ok) {
				error =
					generated.code === 'locked'
						? m.settings_forwarding_err_unlock()
						: m.settings_delegation_generate_failed();
				return;
			}
			await delegations.create(address.id, {
				label: label.trim(),
				publicKeyArmored: generated.publicKeyArmored,
				revokedPublicKeyArmored: generated.revokedPublicKeyArmored
			});
			privateKeyArmored = generated.privateKeyArmored;
			fingerprint = generated.keyFingerprintHex;
			step = 1;
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_delegation_create_failed();
		} finally {
			busy = false;
		}
	}

	async function copyKey() {
		try {
			await navigator.clipboard.writeText(privateKeyArmored);
			copied = true;
			saved = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			error = m.settings_forwarding_copy_failed();
		}
	}

	async function downloadKey() {
		const blob = new Blob([privateKeyArmored], { type: 'application/pgp-keys' });
		await platform.saveBlob(blob, fileName);
		saved = true;
	}

	function finish() {
		privateKeyArmored = '';
		onClose();
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<CeremonyShell
	icon={KeyRound}
	eyebrow={m.settings_delegation_title()}
	title={step === 0
		? m.settings_delegation_authorize_title({ email: address.email })
		: m.settings_delegation_save_key_title()}
	steps={[m.settings_delegation_step_name(), m.settings_delegation_step_save()]}
	{step}
	onClose={step === 1 ? finish : onClose}
>
	<div class="cer-pane">
		{#if step === 0}
			<div class="cer-lede">
				<p>
					<Rich text={m.settings_delegation_lede({ email: address.email })} tags={{ b: bold }} />
				</p>
			</div>

			<div class="field">
				<label for="delegation-label">{m.settings_delegation_name_label()}</label>
				<input
					id="delegation-label"
					class="tin"
					bind:value={label}
					maxlength="60"
					placeholder={m.settings_delegation_name_placeholder()}
					autocomplete="off"
					spellcheck="false"
				/>
				<div class="field-hint">{m.settings_delegation_name_hint()}</div>
			</div>

			<div class="field">
				<span class="field-lbl">{m.settings_delegation_expiry_label()}</span>
				<Seg value={expiry} options={expiryChoices} onChange={(v) => (expiry = v)} />
				<div class="field-hint">{m.settings_delegation_expiry_hint()}</div>
			</div>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{:else}
			<div class="cer-lede">
				<p>{m.settings_delegation_key_once()}</p>
			</div>

			<div class="field">
				<span class="field-lbl">{m.settings_forwarding_fingerprint()}</span>
				<div class="mono fp">{fingerprint}</div>
			</div>

			<textarea class="tin mono keyblock" readonly rows="8" value={privateKeyArmored}></textarea>

			<div class="key-actions">
				<Button variant="ghost" onclick={copyKey}>
					<Copy size={15} />
					{copied ? m.common_copied() : m.common_copy()}
				</Button>
				<Button variant="ghost" onclick={downloadKey}>
					<Download size={15} />
					{m.settings_forwarding_download()}
				</Button>
			</div>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
			<Button disabled={!canCreate} onclick={create}>
				{busy ? m.settings_delegation_generating() : m.settings_delegation_generate()}
			</Button>
		{:else}
			<Button disabled={!saved} onclick={finish}>
				{saved ? m.common_done() : m.settings_forwarding_save_first()}
			</Button>
		{/if}
	{/snippet}
</CeremonyShell>

<style>
	.fp {
		font-size: 12px;
		color: var(--ink-700);
		word-break: break-all;
	}

	.keyblock {
		resize: vertical;
		line-height: 1.5;
	}

	.key-actions {
		display: flex;
		gap: 8px;
	}
</style>
