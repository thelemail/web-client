<script lang="ts">
	import { platform } from '$platform';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import Eye from '@lucide/svelte/icons/eye';
	import Forward from '@lucide/svelte/icons/forward';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import Send from '@lucide/svelte/icons/send';

	import CeremonyShell from '../CeremonyShell.svelte';
	import Seg from '../Seg.svelte';
	import { Button } from '$core/components/ui/button';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { Label } from '$core/components/ui/label';
	import { auth } from '$core/stores/auth.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import type { ReadDelegation, ReadDelegationMode } from '$core/api/readDelegations';
	import { prepareForwarding } from './authorize';

	interface Props {
		addressId: string;
		email: string;
		rotating?: ReadDelegation | null;
		onClose: () => void;
	}

	let { addressId, email, rotating = null, onClose }: Props = $props();

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	const MODE_CHOICES = [
		{ v: 'encrypted', l: 'System with a key' },
		{ v: 'plain', l: 'Plain mailbox' }
	];

	let step = $state(0);
	let mode = $state<ReadDelegationMode>('encrypted');
	let label = $state('');
	let destination = $state('');
	let understood = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let privateKeyArmored = $state('');
	let fingerprint = $state('');
	let saved = $state(false);
	let copied = $state(false);

	const target = $derived(rotating ? rotating.destination : destination.trim().toLowerCase());
	const plain = $derived(mode === 'plain');
	const canContinue = $derived(
		!busy &&
			understood &&
			(rotating !== null || (label.trim().length > 0 && EMAIL_RE.test(target) && target !== email.toLowerCase()))
	);
	const fileName = $derived(`thelemail-forwarding-key-${email.replace(/[^a-z0-9]+/gi, '-')}.asc`);

	async function create() {
		if (!canContinue) return;
		const accountId = auth.accountId;
		if (!accountId) {
			error = 'Sign in again and retry.';
			return;
		}
		busy = true;
		error = null;
		try {
			const prepared = await prepareForwarding(accountId, email, target, mode);
			if (rotating) {
				await readDelegations.rotate(addressId, rotating.id, {
					publicKeyArmored: prepared.publicKeyArmored ?? '',
					authorization: prepared.authorization,
					authorizationSignature: prepared.authorizationSignature
				});
			} else {
				await readDelegations.create(addressId, {
					label: label.trim(),
					mode,
					publicKeyArmored: prepared.publicKeyArmored,
					destination: target,
					authorization: prepared.authorization,
					authorizationSignature: prepared.authorizationSignature
				});
			}
			if (plain) {
				onClose();
				return;
			}
			privateKeyArmored = prepared.privateKeyArmored ?? '';
			fingerprint = prepared.keyFingerprintHex ?? '';
			step = 1;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not set up forwarding.';
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
	icon={Forward}
	eyebrow="Forwarding"
	title={step === 1
		? 'Save the private key'
		: rotating
			? `Replace the key for ${rotating.label}`
			: `Forward new mail for ${email}`}
	steps={plain ? undefined : ['Set it up', 'Save the key']}
	{step}
	onClose={step === 1 ? finish : onClose}
>
	<div class="cer-pane">
		{#if step === 0}
			{#if rotating}
				<div class="cer-lede">
					<p>
						A new key replaces the one {rotating.label} uses now. Forwarding to
						<b>{rotating.destination}</b> keeps going, but copies sent from now on only open with the
						new key, so update {rotating.label} right after saving it.
					</p>
				</div>
			{:else}
				<div class="cer-lede">
					<p>New mail sent to <b>{email}</b> is also sent to an address you choose.</p>
				</div>

				<div class="field">
					<span class="field-lbl">Where it goes</span>
					<Seg value={mode} options={MODE_CHOICES} onChange={(v) => (mode = v as ReadDelegationMode)} />
					<div class="field-hint">
						{#if plain}
							An ordinary mailbox such as Gmail. Mail arrives there the way any other mail does, so
							that provider can read it.
						{:else}
							A system you can hand a key to, such as a helpdesk. Every copy is encrypted to that
							key alone.
						{/if}
					</div>
				</div>

				<div class="field">
					<label for="forwarding-label">System name</label>
					<input
						id="forwarding-label"
						class="tin"
						bind:value={label}
						maxlength="60"
						placeholder="Helpdesk"
						autocomplete="off"
						spellcheck="false"
					/>
					<div class="field-hint">Shown in the confirmation email and in your list.</div>
				</div>

				<div class="field">
					<label for="forwarding-destination">Forward to</label>
					<input
						id="forwarding-destination"
						class="tin"
						type="email"
						bind:value={destination}
						maxlength="254"
						placeholder="support@helpdesk.example"
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
					/>
					<div class="field-hint">We send a confirmation link here. Nothing is forwarded until it is used.</div>
				</div>
			{/if}

			<ul class="cer-points">
				<li>
					<Eye size={16} />
					{#if plain}
						<span>
							Forwarded mail leaves Thelemail readable, so whoever runs that mailbox can read it.
						</span>
					{:else}
						<span>Whoever holds the private key can read every message forwarded to it.</span>
					{/if}
				</li>
				<li>
					<Inbox size={16} />
					<span>
						Only mail that arrives after the destination is confirmed is forwarded. Your existing
						mail stays where it is.
					</span>
				</li>
				<li>
					<LockKeyhole size={16} />
					{#if plain}
						<span>
							Your stored mail stays encrypted, and this destination can never send or sign as
							{email}.
						</span>
					{:else}
						<span>The key cannot open your mailbox and cannot send or sign as {email}.</span>
					{/if}
				</li>
				<li>
					<Send size={16} />
					{#if plain}
						<span>
							Only mail that reaches us from outside can be forwarded this way. Mail from other
							Thelemail accounts, and mail that arrives already encrypted, stays in your mailbox and
							is listed as not forwarded. Turning forwarding off stops new copies, and copies
							already delivered cannot be taken back.
						</span>
					{:else}
						<span>
							Mail that reaches us already encrypted to {email} alone is kept in your mailbox but not
							forwarded. Turning forwarding off stops new copies. Copies already delivered cannot be
							taken back.
						</span>
					{/if}
				</li>
			</ul>

			<Label class="cer-ack" for="forwarding-ack">
				<Checkbox id="forwarding-ack" checked={understood} onCheckedChange={(v) => (understood = v === true)} />
				<span>
					I understand that {rotating ? rotating.label : plain ? 'this mailbox and its provider' : 'this system'}
					can read the mail forwarded to it.
				</span>
			</Label>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{:else}
			<div class="cer-lede">
				<p>
					This is the only time the private key is shown. Add it to
					{rotating ? rotating.label : label.trim()} so it can open forwarded mail, then keep or destroy
					your copy.
				</p>
				{#if !rotating}
					<p>A confirmation link is on its way to <b>{target}</b>.</p>
				{/if}
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
			<Button disabled={!canContinue} onclick={create}>
				{busy ? 'Setting up…' : rotating ? 'Make a new key' : 'Set up forwarding'}
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
