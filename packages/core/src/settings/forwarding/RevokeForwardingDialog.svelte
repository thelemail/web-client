<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import CeremonyShell from '../CeremonyShell.svelte';
	import { Button } from '$core/components/ui/button';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { Label } from '$core/components/ui/label';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import type { ReadDelegation } from '$core/api/readDelegations';

	interface Props {
		delegation: ReadDelegation;
		onClose: () => void;
		onRevoked: (label: string) => void;
	}

	let { delegation, onClose, onRevoked }: Props = $props();

	let ack = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function submit() {
		if (!ack || busy) return;
		busy = true;
		error = null;
		try {
			await readDelegations.revoke(delegation.addressId, delegation.id);
			onRevoked(delegation.label);
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not turn off forwarding.';
		} finally {
			busy = false;
		}
	}
</script>

<CeremonyShell icon={Trash2} eyebrow="Forwarding" title="Stop forwarding to {delegation.label}" tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>Turning off forwarding from {delegation.address} to <b>{delegation.destination}</b> means:</p>
		</div>
		<ul class="cer-points">
			<li>
				<Send size={16} />
				<span>New mail is no longer forwarded, and senders stop encrypting copies to this key.</span>
			</li>
			<li>
				<CircleAlert size={16} />
				<span>
					Anything already forwarded stays with {delegation.label}. Thelemail cannot take it back.
				</span>
			</li>
			<li>
				<Inbox size={16} />
				<span>Your mailbox and any other forwarding keep working as before.</span>
			</li>
		</ul>

		<Label class="cer-ack danger" for="revoke-forwarding-ack">
			<Checkbox id="revoke-forwarding-ack" checked={ack} onCheckedChange={(v) => (ack = v === true)} />
			<span>I understand the key is retired for good. To forward again I will set it up from scratch.</span>
		</Label>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>Keep it</Button>
		<Button variant="danger" disabled={!ack || busy} onclick={submit}>
			{busy ? 'Turning off…' : 'Turn off'}
		</Button>
	{/snippet}
</CeremonyShell>
