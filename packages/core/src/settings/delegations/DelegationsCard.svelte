<script lang="ts">
	import { i18n } from '$core/i18n/locale.svelte';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import Info from '@lucide/svelte/icons/info';

	import { m } from '$paraglide/messages.js';
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
		blocked?: string | null;
	}

	let { address, blocked = null }: Props = $props();

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
		return on.toLocaleDateString(i18n.tag, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function shortFingerprint(fp: string): string {
		return fp.slice(0, 16).replace(/(.{4})/g, '$1 ').trim().toUpperCase();
	}
</script>

<div class="scard">
	<CardHead icon={KeyRound} title={m.settings_delegation_title()}>
		{#snippet right()}
			<span class="card-meta">{m.settings_delegation_active_count({ count: active.length })}</span>
			{#if billing.canAddDomains}
				<Button
					variant="secondary"
					size="sm"
					disabled={!!blocked}
					onclick={() => (creating = true)}
				>
					<Plus size={13} />{m.settings_delegation_authorize()}
				</Button>
			{/if}
		{/snippet}
	</CardHead>

	<div class="card-lede">
		{m.settings_delegation_card_lede({ email: address.email })}
	</div>

	{#if blocked}
		<div class="card-note"><Info size={14} />{blocked}</div>
	{/if}

	{#if flash}
		<div class="card-flash"><Check size={14} />{flash}</div>
	{/if}

	{#each items as d (d.id)}
		<div class="rec-row">
			<div class="rec-main">
				<div class="rec-title">
					<span class="rec-label">{d.label}</span>
					{#if d.revokedAt}
						<Badge kind="warn" dot>{m.settings_delegation_badge_revoked()}</Badge>
					{:else}
						<Badge kind="ok" dot>{m.settings_delegation_badge_active()}</Badge>
					{/if}
				</div>
				<div class="rec-meta">
					<span class="mono">{shortFingerprint(d.signerFingerprint)}</span>
					<span>
						{#if d.revokedAt}
							{m.settings_delegation_revoked_on({ date: fmtDate(d.revokedAt) })}
						{:else}
							{m.settings_delegation_expires_on({ date: fmtDate(d.notAfter) })}
						{/if}
					</span>
				</div>
			</div>
			{#if !d.revokedAt}
				<Button variant="ghost" size="sm" onclick={() => (revoking = d)}>{m.settings_delegation_revoke()}</Button>
			{/if}
		</div>
	{/each}

	{#if items.length === 0 && !delegations.loading}
		<div class="card-empty">{m.settings_delegation_empty()}</div>
	{/if}

	{#if delegations.error}
		<div class="card-empty err">{delegations.error}</div>
	{/if}

	{#if !billing.canAddDomains}
		<UpgradeNudge
			title={m.settings_delegation_upgrade_title()}
			desc={m.settings_delegation_upgrade_desc()}
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
		onRevoked={(label) => (flash = m.settings_delegation_revoked_done({ label, email: address.email }))}
	/>
{/if}
