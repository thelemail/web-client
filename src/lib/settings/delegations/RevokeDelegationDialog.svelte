<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import MailX from '@lucide/svelte/icons/mail-x';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import CeremonyShell from '../CeremonyShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { delegations } from '$lib/stores/delegations.svelte';
	import type { SigningDelegation } from '$lib/api/delegations';

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
			error = err instanceof Error ? err.message : 'Could not revoke this delegation';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell icon={Trash2} eyebrow="Signing delegation" title="Revoke {target}" tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>Revoking <b>{target}</b> for {delegation.address} means:</p>
		</div>
		<ul class="cer-points">
			<li>
				<ShieldOff size={16} />
				<span>
					Thelemail stops treating new mail signed with this key as authorized. Mail the service
					already sent stays verified.
				</span>
			</li>
			<li>
				<Clock size={16} />
				<span>
					People outside Thelemail may keep trusting the key until their mail client refreshes it,
					usually within a day. We publish the revocation for 90 days so they pick it up.
				</span>
			</li>
			<li>
				<MailX size={16} />
				<span>
					Your other delegations, your own signing key and your mailbox are untouched.
				</span>
			</li>
		</ul>

		<label class="cer-ack danger">
			<input type="checkbox" bind:checked={ack} />
			<span>I understand this service will no longer be able to sign as {delegation.address}.</span>
		</label>

		<div class="field">
			<label for="revoke-delegation-confirm">Type <span class="mono">{target}</span> to confirm</label>
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
		<Button variant="ghost" disabled={busy} onclick={onClose}>Keep it</Button>
		<Button variant="danger" disabled={!canRevoke} onclick={submit}>
			{busy ? 'Revoking…' : 'Revoke'}
		</Button>
	{/snippet}
</CeremonyShell>
