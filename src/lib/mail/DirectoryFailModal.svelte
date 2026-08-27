<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { DirectoryVerificationCode } from '$lib/directory/verify';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		inner: DirectoryVerificationCode;
		recipient: Recipient;
		requestedAddress?: string;
		statementAddress?: string;
		signedKeyFingerprint?: string;
		servedKeyFingerprint?: string;
		expectedSignerFingerprint?: string;
		actualSignerFingerprint?: string;
		seenVersion?: number;
		servedVersion?: number;
		onEditRecipient: () => void;
		onRetry: () => void;
		onCancel: () => void;
	}

	let {
		inner,
		recipient,
		requestedAddress,
		statementAddress,
		signedKeyFingerprint,
		servedKeyFingerprint,
		expectedSignerFingerprint,
		actualSignerFingerprint,
		seenVersion,
		servedVersion,
		onEditRecipient,
		onRetry,
		onCancel
	}: Props = $props();

	let tech = $state(false);
	let what = $state(false);

	const FP = {
		expectedSigner: 'D41E 7F09 2B6A C835 11E0 · 9A7C 6F2D 4B18 0C53 A9E2',
		actualSigner: '6B22 0CF4 8E19 77A3 D5B0 · 1F4E 9C28 33A1 7E60 B8D9',
		signed: 'A93C 1E07 5F2B 88D4 6A1F · 0C73 E912 4B58 9D20 7AE6',
		served: 'F70B 4A29 D183 6C95 22E1 · 8B40 3F7C 19A5 0D6E C214'
	};

	type Row = [string, string];

	const finding = $derived.by<{ plain: string; rows: Row[] }>(() => {
		const addr = requestedAddress ?? recipient.email;
		switch (inner) {
			case 'signature_invalid':
				return {
					plain:
						"The directory's signature on this address didn't verify against the key your client trusts.",
					rows: [
						['Error code', 'signature_invalid'],
						['Address', addr],
						['Trusted signer', expectedSignerFingerprint ?? FP.expectedSigner]
					]
				};
			case 'signing_key_mismatch':
				return {
					plain:
						"The record was signed by a different directory authority than the one this build of Thelemail trusts. Your client may be out of date — or the server is signing under a key we don't recognise.",
					rows: [
						['Error code', 'signing_key_mismatch'],
						['Expected signer', expectedSignerFingerprint ?? FP.expectedSigner],
						['Statement signed by', actualSignerFingerprint ?? FP.actualSigner]
					]
				};
			case 'address_mismatch':
				return {
					plain:
						'The signed record the server returned is for a different address than the one you typed. Someone may be standing in for the recipient you intended.',
					rows: [
						['Error code', 'address_mismatch'],
						['You addressed', addr],
						['Record is for', statementAddress ?? 'a different address']
					]
				};
			case 'fingerprint_mismatch':
				return {
					plain:
						"The public key the server handed back doesn't match the key the directory actually signed for this recipient. That is what a key-substitution attack looks like.",
					rows: [
						['Error code', 'fingerprint_mismatch'],
						['Directory signed', signedKeyFingerprint ?? FP.signed],
						['Server returned', servedKeyFingerprint ?? FP.served]
					]
				};
			case 'algorithm_mismatch':
				return {
					plain:
						"The signed record uses a key algorithm this client won't accept for encryption.",
					rows: [
						['Error code', 'algorithm_mismatch'],
						['Record claims', 'ecdh-x448'],
						['Accepted here', 'ed25519, rsa ≥ 3072']
					]
				};
			case 'version_rolled_back':
				return {
					plain:
						'The server is offering an older record for this recipient than this device has already verified once before. That can mean a replay or rollback.',
					rows: [
						['Error code', 'version_rolled_back'],
						['Verified here before', seenVersion !== undefined ? `v${seenVersion}` : 'v7'],
						['Server now serves', servedVersion !== undefined ? `v${servedVersion}` : 'v5']
					]
				};
			case 'fingerprint_changed':
				return {
					plain:
						"The directory's record verified, but the key it pins is different from the one this device pinned previously.",
					rows: [
						['Error code', 'fingerprint_changed'],
						['Previously pinned', signedKeyFingerprint ?? FP.signed],
						['Now serves', servedKeyFingerprint ?? FP.served]
					]
				};
			case 'statement_malformed':
				return {
					plain: "The directory's response is missing fields we need before we can trust any of it.",
					rows: [
						['Error code', 'statement_malformed'],
						['Missing fields', 'signingKeyFingerprint, version']
					]
				};
			default:
				return {
					plain:
						"The record's transparency-log evidence didn't hold up, so this client can't confirm the directory is showing everyone the same key for this recipient.",
					rows: [
						['Error code', inner],
						['Address', addr]
					]
				};
		}
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onCancel();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div
	class="dv-scrim"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="dv-title"
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="dv-modal" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="dv-crest">
			<span class="dv-seal"><ShieldAlert size={26} /></span>
			<span class="dv-eyebrow">Directory verification · stopped</span>
		</div>

		<h2 class="dv-title" id="dv-title">
			We held this message back before it left your device.
		</h2>
		<p class="dv-lede">
			Thelemail couldn't trust what the server asserted about
			<b>{recipient.name || recipient.email}</b>. This isn't the same as "recipient not found" — the
			account probably exists, but the signed record binding their address to a key didn't hold up.
			So nothing was encrypted, and nothing was sent.
		</p>

		<div class="dv-finding">
			<div class="dv-finding-h">What we found</div>
			<p>{finding.plain}</p>
		</div>

		<div class="dv-assure">
			<Lock size={14} />
			No bytes were encrypted to the suspect key. Your draft is untouched and stays exactly as you
			wrote it.
		</div>

		<div class="dv-fold">
			<button type="button" class="dv-disclose" class:open={tech} onclick={() => (tech = !tech)}>
				<ChevronRight size={15} />Show technical details
			</button>
			{#if tech}
				<div class="dv-tech">
					{#each finding.rows as [k, v], i (i)}
						<div class="dv-techrow">
							<span class="dv-tk">{k}</span>
							<span class="dv-tv">{v}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<button type="button" class="dv-what" class:open={what} onclick={() => (what = !what)}>
			What is this?
			{#if what}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
		{#if what}
			<div class="dv-explainer">
				Every Thelemail address is published with a record, signed offline by the directory
				authority, that binds the address to a specific encryption key. Before sending, your client
				re-checks that signature itself. A passing check proves the directory <i>signed</i> this binding
				— it doesn't prove the operator running the directory is honest. When the check fails, we'd
				rather stop than encrypt to a key we can't vouch for. Retrying won't change the answer: the
				same server returns the same record.
			</div>
		{/if}

		<div class="dv-actions">
			<button type="button" class="dv-btn primary" onclick={onEditRecipient}>
				<Pencil size={15} />Edit recipient
			</button>
			<button
				type="button"
				class="dv-btn ghost"
				onclick={onRetry}
				title="The server will return the same record"
			>
				<RefreshCw size={15} />Try again
			</button>
			<div class="dv-spacer"></div>
			<button type="button" class="dv-btn link" onclick={onCancel}>Back to draft</button>
		</div>
	</div>
</div>
