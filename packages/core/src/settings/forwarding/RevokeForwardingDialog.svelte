<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
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
			error = err instanceof Error ? err.message : m.settings_forwarding_revoke_failed();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<CeremonyShell icon={Trash2} eyebrow={m.settings_forwarding_title()} title={m.settings_forwarding_revoke_title({ label: delegation.label })} tone="danger" {onClose}>
	<div class="cer-pane">
		<div class="cer-lede">
			<p>
				<Rich
					text={m.settings_forwarding_revoke_lede({ address: delegation.address, destination: delegation.destination })}
					tags={{ b: bold }}
				/>
			</p>
		</div>
		<ul class="cer-points">
			<li>
				<Send size={16} />
				<span>{m.settings_forwarding_revoke_point_new()}</span>
			</li>
			<li>
				<CircleAlert size={16} />
				<span>{m.settings_forwarding_revoke_point_kept({ label: delegation.label })}</span>
			</li>
			<li>
				<Inbox size={16} />
				<span>{m.settings_forwarding_revoke_point_mailbox()}</span>
			</li>
		</ul>

		<Label class="cer-ack danger" for="revoke-forwarding-ack">
			<Checkbox id="revoke-forwarding-ack" checked={ack} onCheckedChange={(v) => (ack = v === true)} />
			<span>{m.settings_forwarding_revoke_ack()}</span>
		</Label>

		{#if error}
			<div class="field-hint bad"><CircleAlert size={13} />{error}</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>{m.settings_forwarding_revoke_keep()}</Button>
		<Button variant="danger" disabled={!ack || busy} onclick={submit}>
			{busy ? m.settings_forwarding_revoke_busy() : m.settings_forwarding_turn_off()}
		</Button>
	{/snippet}
</CeremonyShell>
