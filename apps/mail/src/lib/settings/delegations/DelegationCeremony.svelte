<script lang="ts">
	import { platform } from '$platform';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import KeyRound from '@lucide/svelte/icons/key-round';

	import CeremonyShell from '../CeremonyShell.svelte';
	import Seg from '../Seg.svelte';
	import { Button } from '$lib/components/ui/button';
	import { auth } from '$lib/stores/auth.svelte';
	import { delegations } from '$lib/stores/delegations.svelte';
	import { keystore } from '$lib/keystore/keystore-client';
	import type { AccountAddress } from '$lib/api/addresses';

	interface Props {
		address: AccountAddress;
		onClose: () => void;
	}

	let { address, onClose }: Props = $props();

	const EXPIRY_CHOICES = [
		{ v: '90', l: '90 days' },
		{ v: '365', l: '1 year' },
		{ v: '730', l: '2 years' }
	];

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
			error = 'Sign in again and retry.';
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
						? 'Unlock your mailbox and try again.'
						: 'Could not generate a signing key.';
				return;
			}
			await delegations.create(address.id, {
				label: label.trim(),
				publicKeyArmored: generated.publicKeyArmored,
				revokedPublicKeyArmored: generated.revokedPublicKeyArmored,
				keyAlgorithm: 'openpgp-ed25519'
			});
			privateKeyArmored = generated.privateKeyArmored;
			fingerprint = generated.keyFingerprintHex;
			step = 1;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create this delegation';
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
			error = 'Could not copy. Use Download instead.';
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

<CeremonyShell
	icon={KeyRound}
	eyebrow="Signing delegation"
	title={step === 0 ? `Authorize a service for ${address.email}` : 'Save the signing key'}
	steps={['Name it', 'Save the key']}
	{step}
	onClose={step === 1 ? finish : onClose}
>
	<div class="cer-pane">
		{#if step === 0}
			<div class="cer-lede">
				<p>
					The service gets its own key that can sign as <b>{address.email}</b> and nothing else.
					It cannot read your mail, and you can withdraw it at any time.
				</p>
			</div>

			<div class="field">
				<label for="delegation-label">Service name</label>
				<input
					id="delegation-label"
					class="tin"
					bind:value={label}
					maxlength="60"
					placeholder="Billing provider"
					autocomplete="off"
					spellcheck="false"
				/>
				<div class="field-hint">Only you see this. It labels the key in your list.</div>
			</div>

			<div class="field">
				<span class="field-lbl">Expires after</span>
				<Seg value={expiry} options={EXPIRY_CHOICES} onChange={(v) => (expiry = v)} />
				<div class="field-hint">The key stops signing on its own when it expires.</div>
			</div>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{:else}
			<div class="cer-lede">
				<p>
					This is the only time the private key is shown. Give it to the service, then keep or
					destroy your copy.
				</p>
			</div>

			<div class="field">
				<span class="field-lbl">Fingerprint</span>
				<div class="mono fp">{fingerprint}</div>
			</div>

			<textarea class="tin mono keyblock" readonly rows="8" value={privateKeyArmored}></textarea>

			<div class="key-actions">
				<Button variant="ghost" onclick={copyKey}>
					<Copy size={15} />
					{copied ? 'Copied' : 'Copy'}
				</Button>
				<Button variant="ghost" onclick={downloadKey}>
					<Download size={15} />
					Download
				</Button>
			</div>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
			<Button disabled={!canCreate} onclick={create}>
				{busy ? 'Generating…' : 'Generate key'}
			</Button>
		{:else}
			<Button disabled={!saved} onclick={finish}>
				{saved ? 'Done' : 'Copy or download first'}
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
