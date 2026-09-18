<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';

	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import DelegationCeremony from './DelegationCeremony.svelte';
	import RevokeDelegationDialog from './RevokeDelegationDialog.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import { Button } from '$core/components/ui/button';
	import { billing } from '$core/stores/billing.svelte';
	import { delegations } from '$core/stores/delegations.svelte';
	import type { AccountAddress } from '$core/api/addresses';
	import type { SigningDelegation } from '$core/api/delegations';

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

	function fmtDate(iso: string): string {
		const on = new Date(iso);
		if (Number.isNaN(on.getTime())) return iso;
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
			{#if billing.canAddDomains}
				<Button variant="secondary" size="sm" onclick={() => (creating = true)}>
					<Plus size={13} />Authorize a service
				</Button>
			{/if}
		{/snippet}
	</CardHead>

	<div class="card-lede">
		Let a service sign mail as {address.email} without giving it access to your mailbox. Each
		service gets its own key, which you can revoke at any time.
	</div>

	{#if flash}
		<div class="card-flash"><Check size={14} />{flash}</div>
	{/if}

	{#each items as d (d.id)}
		<div class="rec-row">
			<div class="rec-main">
				<div class="rec-title">
					<span class="rec-label">{d.label}</span>
					{#if d.revokedAt}
						<Badge kind="warn" dot>Revoked</Badge>
					{:else}
						<Badge kind="ok" dot>Active</Badge>
					{/if}
				</div>
				<div class="rec-meta">
					<span class="mono">{shortFingerprint(d.signerFingerprint)}</span>
					<span>
						{#if d.revokedAt}
							Revoked {fmtDate(d.revokedAt)} · still published so other mail clients pick up the
							revocation
						{:else}
							Expires {fmtDate(d.notAfter)}
						{/if}
					</span>
				</div>
			</div>
			{#if !d.revokedAt}
				<Button variant="ghost" size="sm" onclick={() => (revoking = d)}>Revoke</Button>
			{/if}
		</div>
	{/each}

	{#if items.length === 0 && !delegations.loading}
		<div class="card-empty">No services are authorized yet.</div>
	{/if}

	{#if delegations.error}
		<div class="card-empty err">{delegations.error}</div>
	{/if}

	{#if !billing.canAddDomains}
		<UpgradeNudge
			title="Signing delegation comes with a paid plan"
			desc="Paid plans let a service sign as an address on your own domain, without mailbox access."
		/>
	{/if}
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
