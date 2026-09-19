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

	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
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

	const modeChoices = $derived([
		{ v: 'encrypted', l: m.settings_forwarding_mode_encrypted() },
		{ v: 'plain', l: m.settings_forwarding_mode_plain() }
	]);

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
			error = m.settings_forwarding_sign_in_again();
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
			error = err instanceof Error ? err.message : m.settings_forwarding_setup_failed();
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
	icon={Forward}
	eyebrow={m.settings_forwarding_title()}
	title={step === 1
		? m.settings_forwarding_save_key_title()
		: rotating
			? m.settings_forwarding_replace_title({ label: rotating.label })
			: m.settings_forwarding_new_title({ email })}
	steps={plain ? undefined : [m.settings_forwarding_step_setup(), m.settings_forwarding_step_save()]}
	{step}
	onClose={step === 1 ? finish : onClose}
>
	<div class="cer-pane">
		{#if step === 0}
			{#if rotating}
				<div class="cer-lede">
					<p>
						<Rich
							text={m.settings_forwarding_replace_lede({
								label: rotating.label,
								destination: rotating.destination
							})}
							tags={{ b: bold }}
						/>
					</p>
				</div>
			{:else}
				<div class="cer-lede">
					<p><Rich text={m.settings_forwarding_new_lede({ email })} tags={{ b: bold }} /></p>
				</div>

				<div class="field">
					<span class="field-lbl">{m.settings_forwarding_where()}</span>
					<Seg value={mode} options={modeChoices} onChange={(v) => (mode = v as ReadDelegationMode)} />
					<div class="field-hint">
						{#if plain}
							{m.settings_forwarding_plain_hint()}
						{:else}
							{m.settings_forwarding_encrypted_hint()}
						{/if}
					</div>
				</div>

				<div class="field">
					<label for="forwarding-label">{m.settings_forwarding_name_label()}</label>
					<input
						id="forwarding-label"
						class="tin"
						bind:value={label}
						maxlength="60"
						placeholder={m.settings_forwarding_name_placeholder()}
						autocomplete="off"
						spellcheck="false"
					/>
					<div class="field-hint">{m.settings_forwarding_name_hint()}</div>
				</div>

				<div class="field">
					<label for="forwarding-destination">{m.settings_forwarding_to_label()}</label>
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
					<div class="field-hint">{m.settings_forwarding_to_hint()}</div>
				</div>
			{/if}

			<ul class="cer-points">
				<li>
					<Eye size={16} />
					{#if plain}
						<span>{m.settings_forwarding_point_plain_readable()}</span>
					{:else}
						<span>{m.settings_forwarding_point_key_readable()}</span>
					{/if}
				</li>
				<li>
					<Inbox size={16} />
					<span>{m.settings_forwarding_point_after_confirm()}</span>
				</li>
				<li>
					<LockKeyhole size={16} />
					{#if plain}
						<span>{m.settings_forwarding_point_plain_no_send({ email })}</span>
					{:else}
						<span>{m.settings_forwarding_point_key_no_send({ email })}</span>
					{/if}
				</li>
				<li>
					<Send size={16} />
					{#if plain}
						<span>{m.settings_forwarding_point_plain_limits()}</span>
					{:else}
						<span>{m.settings_forwarding_point_key_limits({ email })}</span>
					{/if}
				</li>
			</ul>

			<Label class="cer-ack" for="forwarding-ack">
				<Checkbox id="forwarding-ack" checked={understood} onCheckedChange={(v) => (understood = v === true)} />
				<span>
					{rotating
						? m.settings_forwarding_ack_named({ name: rotating.label })
						: plain
							? m.settings_forwarding_ack_plain()
							: m.settings_forwarding_ack_system()}
				</span>
			</Label>

			{#if error}
				<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
			{/if}
		{:else}
			<div class="cer-lede">
				<p>
					{m.settings_forwarding_key_once({ name: rotating ? rotating.label : label.trim() })}
				</p>
				{#if !rotating}
					<p><Rich text={m.settings_forwarding_link_sent({ target })} tags={{ b: bold }} /></p>
				{/if}
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
			<Button disabled={!canContinue} onclick={create}>
				{busy
					? m.settings_forwarding_setting_up()
					: rotating
						? m.settings_forwarding_make_key()
						: m.settings_forwarding_submit()}
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
