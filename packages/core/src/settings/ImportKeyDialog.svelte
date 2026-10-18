<script lang="ts">
	import Upload from '@lucide/svelte/icons/upload';
	import FileUp from '@lucide/svelte/icons/file-up';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { m } from '$paraglide/messages.js';
	import CeremonyShell from './CeremonyShell.svelte';
	import TextInput from './TextInput.svelte';
	import { Button } from '$core/components/ui/button';
	import { importExternalKey } from '$core/api/externalKeys';
	import { ApiCallError } from '$core/api/types';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
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
	let imported = $state<{ address: string; fingerprint: string } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const canSubmit = $derived(
		!busy && address.trim().includes('@') && armoredKey.includes('BEGIN PGP PUBLIC KEY BLOCK')
	);

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

	async function submit() {
		if (!canSubmit) return;
		busy = true;
		error = null;
		try {
			const target = address.trim().toLowerCase();
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
</script>

<CeremonyShell icon={Upload} eyebrow={m.settings_security_keys_title()} title={m.settings_import_key_title()} {onClose}>
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
		{:else}
			<div class="cer-lede">
				<p>{m.settings_import_key_lede()}</p>
			</div>
			<div class="field">
				<span class="field-lbl">{m.settings_import_key_address()}</span>
				<TextInput
					type="email"
					value={address}
					placeholder="name@example.org"
					onChange={(v) => (address = v)}
					disabled={busy}
				/>
			</div>
			<div class="field">
				<span class="field-lbl">{m.settings_import_key_armored()}</span>
				<textarea
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
					accept=".asc,.gpg,.pgp,.txt,application/pgp-keys"
					onchange={pickFile}
				/>
				<Button variant="ghost" disabled={busy} onclick={() => fileInput?.click()}>
					<FileUp size={15} />{m.settings_import_key_choose_file()}
				</Button>
			</div>
			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if imported}
			<Button variant="primary" onclick={onClose}>{m.common_done()}</Button>
		{:else}
			<Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!canSubmit} onclick={submit}>
				{busy ? m.settings_import_key_importing() : m.settings_import_key_submit()}
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

	.file-pick {
		display: none;
	}
</style>
