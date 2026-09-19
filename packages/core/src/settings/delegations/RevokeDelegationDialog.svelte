<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import MailX from '@lucide/svelte/icons/mail-x';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import CeremonyShell from '../CeremonyShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { Label } from '$core/components/ui/label';
	import { delegations } from '$core/stores/delegations.svelte';
	import type { SigningDelegation } from '$core/api/delegations';

	interface Props {
		delegation: SigningDelegation;
		onClose: () => void;
		onRevoked: (label: string) => void;
	}

	let { delegation, onClose, onRevoked }: Props = $props();

	let ack = $state(false);
	let confirmText = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const target = $derived(delegation.label);
	const canRevoke = $derived(
		ack && confirmText.trim().toLowerCase() === target.toLowerCase() && !busy
	);

	async function submit() {
		if (!canRevoke) return;
		busy = true;
		error = null;
		try {
			await delegations.revoke(delegation.addressId, delegation.id);
			onRevoked(target);
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_delegation_revoke_failed();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}

<CeremonyShell icon={Trash2} eyebrow={m.settings_delegation_title()} title={m.settings_delegation_revoke_title({ label: target })} tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>
				<Rich
					text={m.settings_delegation_revoke_lede({ label: target, address: delegation.address })}
					tags={{ b: bold }}
				/>
			</p>
		</div>
		<ul class="cer-points">
			<li>
				<ShieldOff size={16} />
				<span>{m.settings_delegation_revoke_point_stop()}</span>
			</li>
			<li>
				<Clock size={16} />
				<span>{m.settings_delegation_revoke_point_outside()}</span>
			</li>
			<li>
				<MailX size={16} />
				<span>{m.settings_delegation_revoke_point_untouched()}</span>
			</li>
		</ul>

		<Label class="cer-ack danger" for="revoke-delegation-ack">
			<Checkbox
				id="revoke-delegation-ack"
				checked={ack}
				onCheckedChange={(v) => (ack = v === true)}
			/>
			<span>{m.settings_delegation_revoke_ack({ address: delegation.address })}</span>
		</Label>

		<div class="field">
			<label for="revoke-delegation-confirm">
				<Rich text={m.settings_delegation_revoke_confirm({ label: target })} tags={{ code: mono }} />
			</label>
			<input
				id="revoke-delegation-confirm"
				class="tin"
				bind:value={confirmText}
				placeholder={target}
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
			/>
		</div>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>{m.settings_delegation_revoke_keep()}</Button>
		<Button variant="danger" disabled={!canRevoke} onclick={submit}>
			{busy ? m.settings_delegation_revoking() : m.settings_delegation_revoke()}
		</Button>
	{/snippet}
</CeremonyShell>
