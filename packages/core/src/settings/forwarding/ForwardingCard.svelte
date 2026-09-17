<script lang="ts">
	import Forward from '@lucide/svelte/icons/forward';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import AddRow from '../AddRow.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import ForwardingCeremony from './ForwardingCeremony.svelte';
	import RevokeForwardingDialog from './RevokeForwardingDialog.svelte';
	import { deliveryLabel, summarise } from './deliveryStatus';
	import { billing } from '$core/stores/billing.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import type { ReadDelegation } from '$core/api/readDelegations';

	interface Props {
		addressId: string;
		email: string;
	}

	let { addressId, email }: Props = $props();

	let creating = $state(false);
	let rotating = $state<ReadDelegation | null>(null);
	let revoking = $state<ReadDelegation | null>(null);
	let flash = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	const items = $derived(readDelegations.for(addressId));
	const live = $derived(items.filter((d) => d.state !== 'revoked'));

	$effect(() => {
		void readDelegations.load(addressId);
	});

	function shortFingerprint(fp: string): string {
		return fp.slice(0, 16).replace(/(.{4})/g, '$1 ').trim().toUpperCase();
	}

	async function run(d: ReadDelegation, action: () => Promise<void>, done: string) {
		busyId = d.id;
		flash = null;
		try {
			await action();
			flash = done;
		} catch (err) {
			flash = err instanceof Error ? err.message : 'That did not work. Try again.';
		} finally {
			busyId = null;
		}
	}
</script>

<div class="scard">
	<CardHead icon={Forward} title="Forwarding">
		{#snippet right()}
			<span class="card-meta">{live.length} {live.length === 1 ? 'destination' : 'destinations'}</span>
		{/snippet}
	</CardHead>

	<div class="fwd-lede">
		Send new mail for {email} to a system like a helpdesk, encrypted to a key that only that system holds.
	</div>

	{#if flash}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">{flash}</div></div></div>
	{/if}

	{#each items as d (d.id)}
		{@const summary = summarise(d)}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-name">
					{d.label}
					{#if d.state === 'active'}
						<Badge kind="ok">Forwarding</Badge>
					{:else if d.state === 'pending_verification'}
						<Badge kind="info">Waiting for confirmation</Badge>
					{:else if d.state === 'paused'}
						<Badge kind="neutral">Paused</Badge>
					{:else}
						<Badge kind="warn">Turned off</Badge>
					{/if}
				</div>
				<div class="alias-addr">To {d.destination}</div>
				<div class="alias-addr mono">{shortFingerprint(d.encryptionKeyFingerprint)}</div>
				{#if summary.latest}
					<div class="alias-addr">
						Last message: {deliveryLabel(summary.latest.status)}
						{#if summary.failed || summary.skipped}
							· {summary.delivered} delivered, {summary.failed} not delivered, {summary.skipped} not forwarded recently
						{/if}
					</div>
				{:else if d.state === 'active'}
					<div class="alias-addr">Nothing forwarded yet.</div>
				{/if}
			</div>
			{#if d.state === 'pending_verification'}
				<button
					type="button"
					class="rowmenu"
					title="Send the confirmation link again"
					disabled={busyId === d.id}
					onclick={() => run(d, () => readDelegations.resend(addressId, d.id), `A new link is on its way to ${d.destination}.`)}
				>
					<MailCheck size={16} />
				</button>
			{/if}
			{#if d.state === 'active'}
				<button
					type="button"
					class="rowmenu"
					title="Pause"
					disabled={busyId === d.id}
					onclick={() => run(d, () => readDelegations.pause(addressId, d.id), `Forwarding to ${d.label} is paused.`)}
				>
					<Pause size={16} />
				</button>
			{:else if d.state === 'paused'}
				<button
					type="button"
					class="rowmenu"
					title="Resume"
					disabled={busyId === d.id}
					onclick={() => run(d, () => readDelegations.resume(addressId, d.id), `Forwarding to ${d.label} is back on.`)}
				>
					<Play size={16} />
				</button>
			{/if}
			{#if d.state !== 'revoked'}
				<button type="button" class="rowmenu" title="Replace the key" onclick={() => (rotating = d)}>
					<RotateCw size={16} />
				</button>
				<button type="button" class="rowmenu" title="Turn off" onclick={() => (revoking = d)}>
					<Trash2 size={16} />
				</button>
			{/if}
		</div>
	{/each}

	{#if items.length === 0 && !readDelegations.loading}
		<div class="alias-row">
			<div class="alias-info"><div class="alias-addr">Mail to this address is not forwarded anywhere.</div></div>
		</div>
	{/if}

	{#if readDelegations.error}
		<div class="alias-row">
			<div class="alias-info"><div class="alias-addr err">{readDelegations.error}</div></div>
		</div>
	{/if}

	{#if billing.canAddDomains}
		<AddRow label="Forward to a system" onClick={() => (creating = true)} />
	{:else}
		<UpgradeNudge
			title="Forwarding comes with a paid plan"
			desc="Paid plans can send new mail for an address on your own domain to a helpdesk, encrypted."
		/>
	{/if}
</div>

{#if creating}
	<ForwardingCeremony {addressId} {email} onClose={() => (creating = false)} />
{/if}

{#if rotating}
	<ForwardingCeremony {addressId} {email} {rotating} onClose={() => (rotating = null)} />
{/if}

{#if revoking}
	<RevokeForwardingDialog
		delegation={revoking}
		onClose={() => (revoking = null)}
		onRevoked={(label) => (flash = `Nothing new will be forwarded to ${label}.`)}
	/>
{/if}

<style>
	.fwd-lede {
		padding: 13px 18px;
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--fg-muted);
		line-height: 1.55;
	}
</style>
