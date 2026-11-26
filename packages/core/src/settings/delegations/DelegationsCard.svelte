<script lang="ts">
	import { EmptyState } from '$core/components/ui/empty-state';
	import { formatKeyId } from '$core/directory/format';
	import { i18n } from '$core/i18n/locale.svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faCircleInfo,
		faKey,
		faPlus,
		faUserPen
	} from '@fortawesome/pro-regular-svg-icons';

	import { m } from '$paraglide/messages.js';
	import { Badge } from '$core/components/ui/badge';
	import Card from '../Card.svelte';
	import RecordRow from '../RecordRow.svelte';
	import DelegationCeremony from './DelegationCeremony.svelte';
	import RevokeDelegationDialog from './RevokeDelegationDialog.svelte';
	import { delegationStatus } from './status';
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
	const rows = $derived.by(() => {
		const now = Date.now();
		return items.map((d) => ({ d, status: delegationStatus(d, now) }));
	});
	const active = $derived(rows.filter((r) => r.status === 'active'));

	$effect(() => {
		void delegations.load(address.id);
	});

	function fmtDate(iso: string): string {
		const on = new Date(iso);
		if (Number.isNaN(on.getTime())) return iso;
		return on.toLocaleDateString(i18n.tag, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<Card icon={faKey} title={m.settings_delegation_title()}>
	{#snippet right()}
		<span class="card-meta">{m.settings_delegation_active_count({ count: active.length })}</span>
		{#if billing.canAddDomains}
			<Button
				variant="tonal"
				size="sm"
				disabled={!!blocked}
				onclick={() => (creating = true)}
			>
				<Icon icon={faPlus} size={13} />{m.settings_delegation_authorize()}
			</Button>
		{/if}
	{/snippet}

	<div class="card-lede">
		{m.settings_delegation_card_lede({ email: address.email })}
	</div>

	{#if blocked}
		<div class="card-note"><Icon icon={faCircleInfo} size={14} />{blocked}</div>
	{/if}

	{#if flash}
		<div class="card-flash"><Icon icon={faCheck} size={14} />{flash}</div>
	{/if}

	{#each rows as { d, status } (d.id)}
		<RecordRow label={d.label}>
			{#snippet badges()}
				{#if status === 'revoked'}
					<Badge tone="warning" status>{m.settings_delegation_badge_revoked()}</Badge>
				{:else if status === 'expired'}
					<Badge tone="neutral" status>{m.settings_delegation_badge_expired()}</Badge>
				{:else}
					<Badge tone="success" status>{m.settings_delegation_badge_active()}</Badge>
				{/if}
			{/snippet}
			<div class="rec-meta">
				<span class="mono">{formatKeyId(d.signerFingerprint)}</span>
				<span>
					{#if status === 'revoked'}
						{m.settings_delegation_revoked_on({ date: fmtDate(d.revokedAt ?? '') })}
					{:else if status === 'expired'}
						{m.settings_delegation_expired_on({ date: fmtDate(d.notAfter) })}
					{:else}
						{m.settings_delegation_expires_on({ date: fmtDate(d.notAfter) })}
					{/if}
				</span>
			</div>
			{#snippet actions()}
				{#if status === 'active'}
					<Button variant="ghost" size="sm" onclick={() => (revoking = d)}>{m.settings_delegation_revoke()}</Button>
				{/if}
			{/snippet}
		</RecordRow>
	{/each}

	{#if items.length === 0 && !delegations.loading}
		<EmptyState compact icon={faUserPen} title={m.settings_delegation_empty()} />
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
</Card>

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
