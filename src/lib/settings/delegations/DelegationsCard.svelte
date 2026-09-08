<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	import AddRow from '../AddRow.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import DelegationCeremony from './DelegationCeremony.svelte';
	import RevokeDelegationDialog from './RevokeDelegationDialog.svelte';
	import { delegations } from '$lib/stores/delegations.svelte';
	import type { AccountAddress } from '$lib/api/addresses';
	import type { SigningDelegation } from '$lib/api/delegations';

	interface Props {
		address: AccountAddress;
	}

	let { address }: Props = $props();

	let creating = $state(false);
	let revoking = $state<SigningDelegation | null>(null);
	let flash = $state<string | null>(null);

	const items = $derived(delegations.for(address.id));
	const active = $derived(items.filter((d) => !d.revokedAt));

	$effect(() => {
		void delegations.load(address.id);
	});

	function expiryLabel(d: SigningDelegation): string {
		const on = new Date(d.notAfter);
		return on.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function shortFingerprint(fp: string): string {
		return fp.slice(0, 16).replace(/(.{4})/g, '$1 ').trim().toUpperCase();
	}
</script>

<div class="scard">
	<CardHead icon={KeyRound} title="Signing delegation">
		{#snippet right()}
			<span class="card-meta">{active.length} active</span>
		{/snippet}
	</CardHead>

	<div class="deleg-lede">
		Let a service sign mail as {address.email} without giving it access to your mailbox.
	</div>

	{#if flash}
		<div class="alias-row"><div class="alias-info"><div class="alias-addr">{flash}</div></div></div>
	{/if}

	{#each items as d (d.id)}
		<div class="alias-row">
			<div class="alias-info">
				<div class="alias-name">
					{d.label}
					{#if d.revokedAt}
						<Badge kind="warn">Revoked</Badge>
					{:else}
						<Badge kind="ok">Active</Badge>
					{/if}
				</div>
				<div class="alias-addr mono">{shortFingerprint(d.signerFingerprint)}</div>
				<div class="alias-addr">
					{#if d.revokedAt}
						Revoked {new Date(d.revokedAt).toLocaleDateString()}. Still published so other mail
						clients pick up the revocation.
					{:else}
						Expires {expiryLabel(d)}
					{/if}
				</div>
			</div>
			{#if !d.revokedAt}
				<button type="button" class="rowmenu" title="Revoke" onclick={() => (revoking = d)}>
					<Trash2 size={16} />
				</button>
			{/if}
		</div>
	{/each}

	{#if items.length === 0 && !delegations.loading}
		<div class="alias-row">
			<div class="alias-info"><div class="alias-addr">No services are authorized yet.</div></div>
		</div>
	{/if}

	{#if delegations.error}
		<div class="alias-row">
			<div class="alias-info"><div class="alias-addr err">{delegations.error}</div></div>
		</div>
	{/if}

	<AddRow label="Authorize a service" onClick={() => (creating = true)} />
</div>

{#if creating}
	<DelegationCeremony {address} onClose={() => (creating = false)} />
{/if}

{#if revoking}
	<RevokeDelegationDialog
		delegation={revoking}
		onClose={() => (revoking = null)}
		onRevoked={(label) => (flash = `${label} can no longer sign as ${address.email}.`)}
	/>
{/if}

<style>
	.deleg-lede {
		padding: 13px 18px;
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--fg-muted);
		line-height: 1.55;
	}
</style>
