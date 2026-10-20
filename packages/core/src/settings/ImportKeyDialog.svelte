<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import FileUp from '@lucide/svelte/icons/file-up';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { m } from '$paraglide/messages.js';
	import CeremonyShell from './CeremonyShell.svelte';
	import TextInput from './TextInput.svelte';
	import { Button } from '$core/components/ui/button';
	import { importExternalKey } from '$core/api/externalKeys';
	import { ApiCallError } from '$core/api/types';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import type { ArmoredKeySummary } from '$core/directory/armor';
	import { userIdsMatch } from '$core/directory/userId';
	import { formatFingerprintHex } from '$core/directory/format';
	import { b64ToHex } from '$core/keys/encode';
	import { forgetSenderTrust } from '$core/mail/senderVerify';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const MAX_KEY_BYTES = 1_000_000;

	let address = $state('');
	let armoredKey = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let review = $state<ArmoredKeySummary | null>(null);
	let imported = $state<{ address: string; fingerprint: string } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const target = $derived(address.trim().toLowerCase());
	const canReview = $derived(
		!busy && target.includes('@') && armoredKey.includes('BEGIN PGP PUBLIC KEY BLOCK')
	);
	const mismatch = $derived(review !== null && !userIdsMatch(review.userIds, target));

	async function pickFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > MAX_KEY_BYTES) {
			error = m.settings_import_key_too_large();
			return;
		}
		armoredKey = await file.text();
		error = null;
	}

	async function inspect() {
		if (!canReview) return;
		busy = true;
		error = null;
		try {
			const { inspectArmoredKey } = await import('$core/directory/armor');
			const summary = await inspectArmoredKey(armoredKey);
			if (summary) review = summary;
			else error = m.settings_import_key_malformed();
		} finally {
			busy = false;
		}
	}

	async function pin() {
		if (!review || busy) return;
		busy = true;
		error = null;
		try {
			const trust = await importExternalKey(target, armoredKey.trim());
			forgetSenderTrust(target);
			imported = {
				address: trust.address,
				fingerprint: formatFingerprintHex(b64ToHex(trust.fingerprint))
			};
		} catch (err) {
			if (isReauthenticationRequired(err)) return;
			error =
				err instanceof ApiCallError && err.status === 400
					? m.settings_import_key_rejected()
					: m.settings_import_key_failed();
		} finally {
			busy = false;
		}
	}

	function back() {
		review = null;
		error = null;
	}
</script>

<CeremonyShell icon={Upload} eyebrow={m.settings_security_contact_keys_title()} title={m.settings_import_key_title()} {onClose}>
	<div class="cer-pane">
		{#if imported}
			<div class="cer-lede">
				<p>{m.settings_import_key_done({ address: imported.address })}</p>
			</div>
			<div class="field">
				<span class="field-lbl">{m.settings_forwarding_fingerprint()}</span>
				<div class="mono fp">{imported.fingerprint}</div>
			</div>
			<div class="field-hint"><CircleCheck size={13} />{m.settings_import_key_pinned()}</div>
		{:else if review}
			<div class="cer-lede">
				<p>{m.settings_import_key_review_lede({ address: target })}</p>
			</div>
			<div class="field">
				<span class="field-lbl" id="ik-fp">{m.settings_forwarding_fingerprint()}</span>
				<div class="mono fp" aria-labelledby="ik-fp">{formatFingerprintHex(review.fingerprintHex)}</div>
			</div>
			<div class="field">
				<span class="field-lbl" id="ik-uids">{m.settings_import_key_user_ids()}</span>
				{#if review.userIds.length}
					<ul class="uids" aria-labelledby="ik-uids">
						{#each review.userIds as uid, i (i)}
							<li class="mono">{uid}</li>
						{/each}
					</ul>
				{:else}
					<div class="field-hint">{m.settings_import_key_no_user_ids()}</div>
				{/if}
			</div>
			{#if mismatch}
				<div class="inline-warn" role="alert">
					<TriangleAlert size={15} />
					<span>{m.settings_import_key_uid_mismatch({ address: target })}</span>
				</div>
			{/if}
			{#if error}
				<div class="field-hint bad" role="alert"><CircleAlert size={13} />{error}</div>
			{/if}
		{:else}
			<div class="cer-lede">
				<p>{m.settings_import_key_lede()}</p>
			</div>
			<div class="field">
				<label class="field-lbl" for="ik-addr">{m.settings_import_key_address()}</label>
				<TextInput
					type="email"
					value={address}
					placeholder="name@example.org"
					id="ik-addr"
					onChange={(v) => (address = v)}
					disabled={busy}
				/>
			</div>
			<div class="field">
				<label class="field-lbl" for="ik-armored">{m.settings_import_key_armored()}</label>
				<textarea
					id="ik-armored"
					class="tin mono keyblock"
					rows="8"
					placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
					value={armoredKey}
					disabled={busy}
					oninput={(e) => (armoredKey = (e.currentTarget as HTMLTextAreaElement).value)}
				></textarea>
			</div>
			<div class="key-actions">
				<input
					bind:this={fileInput}
					class="file-pick"
					type="file"
					tabindex="-1"
					aria-hidden="true"
					accept=".asc,.gpg,.pgp,.txt,application/pgp-keys"
					onchange={pickFile}
				/>
				<Button variant="ghost" disabled={busy} onclick={() => fileInput?.click()}>
					<FileUp size={15} />{m.settings_import_key_choose_file()}
				</Button>
			</div>
			{#if error}
				<div class="field-hint bad" role="alert"><CircleAlert size={13} />{error}</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if imported}
			<Button variant="primary" onclick={onClose}>{m.common_done()}</Button>
		{:else if review}
			<Button variant="ghost" disabled={busy} onclick={back}>{m.common_back()}</Button>
			<Button variant="primary" disabled={busy} onclick={pin}>
				{busy ? m.settings_import_key_pinning() : m.settings_import_key_pin()}
			</Button>
		{:else}
			<Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!canReview} onclick={inspect}>
				{m.settings_import_key_review()}
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

	.uids {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		color: var(--ink-700);
		overflow-wrap: anywhere;
	}

	.keyblock {
		resize: vertical;
		line-height: 1.5;
	}

	.key-actions {
		display: flex;
		gap: 8px;
	}

	.file-pick {
		display: none;
	}
</style>
