<script lang="ts">
	import { formatKeyId } from '$core/directory/format';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRight,
		faCheck,
		faCircleInfo,
		faEllipsis,
		faEnvelope,
		faPause,
		faPlay,
		faPlus,
		faRotateRight,
		faShare,
		faTrashCan
	} from '@fortawesome/pro-regular-svg-icons';

	import { m } from '$paraglide/messages.js';
	import { Badge } from '$core/components/ui/badge';
	import Card from '../Card.svelte';
	import RecordRow from '../RecordRow.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import ForwardingCeremony from './ForwardingCeremony.svelte';
	import RevokeForwardingDialog from './RevokeForwardingDialog.svelte';
	import { deliveryLabel, deliveryTone, summarise } from './deliveryStatus';
	import { Button } from '$core/components/ui/button';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { billing } from '$core/stores/billing.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import type { ReadDelegation } from '$core/api/readDelegations';

	interface Props {
		addressId: string;
		email: string;
		blocked?: string | null;
	}

	let { addressId, email, blocked = null }: Props = $props();

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


	function keyLine(d: ReadDelegation): string {
		if (d.mode === 'plain') return m.settings_forwarding_key_plain();
		return d.encryptionKeyFingerprint ? formatKeyId(d.encryptionKeyFingerprint) : '';
	}

	function deliveryText(d: ReadDelegation): string {
		const summary = summarise(d);
		if (summary.latest) {
			let out: string = m.settings_forwarding_last_message({ status: deliveryLabel(summary.latest.status) });
			if (summary.failed || summary.skipped) {
				out += ` · ${m.settings_forwarding_recent_summary({ delivered: summary.delivered, failed: summary.failed, skipped: summary.skipped })}`;
			}
			return out;
		}
		if (d.state === 'active') return m.settings_forwarding_nothing_yet();
		if (d.state === 'pending_verification') {
			return m.settings_forwarding_waiting_link({ destination: d.destination });
		}
		return '';
	}

	function deliveryColor(d: ReadDelegation): string {
		const summary = summarise(d);
		if (!summary.latest) return 'var(--fg-muted)';
		const tone = deliveryTone(summary.latest.status);
		if (tone === 'ok') return 'var(--success-700)';
		if (tone === 'warn') return 'var(--warning-700)';
		return 'var(--fg-muted)';
	}

	async function run(d: ReadDelegation, action: () => Promise<void>, done: string) {
		busyId = d.id;
		flash = null;
		try {
			await action();
			flash = done;
		} catch (err) {
			flash = err instanceof Error ? err.message : m.settings_forwarding_action_failed();
		} finally {
			busyId = null;
		}
	}
</script>

<Card icon={faShare} title={m.settings_forwarding_title()} variant="menus">
	{#snippet right()}
		<span class="card-meta">
			{m.settings_forwarding_destinations({ count: live.length })}
		</span>
		{#if billing.canAddDomains}
			<Button
				variant="tonal"
				size="sm"
				disabled={!!blocked}
				onclick={() => (creating = true)}
			>
				<Icon icon={faPlus} size={13} />{m.settings_forwarding_add()}
			</Button>
		{/if}
	{/snippet}

	<div class="card-lede">
		{m.settings_forwarding_lede({ email })}
	</div>

	{#if blocked}
		<div class="card-note"><Icon icon={faCircleInfo} size={14} />{blocked}</div>
	{/if}

	{#if flash}
		<div class="card-flash"><Icon icon={faCheck} size={14} />{flash}</div>
	{/if}

	{#each items as d (d.id)}
		<RecordRow label={d.label} top>
			{#snippet badges()}
				{#if d.state === 'active'}
					<Badge tone="success" status>{m.settings_forwarding_badge_active()}</Badge>
				{:else if d.state === 'pending_verification'}
					<Badge tone="info" status>{m.settings_forwarding_badge_pending()}</Badge>
				{:else if d.state === 'paused'}
					<Badge tone="neutral" status>{m.settings_forwarding_badge_paused()}</Badge>
				{:else}
					<Badge tone="warning" status>{m.settings_forwarding_badge_off()}</Badge>
				{/if}
				{#if d.mode === 'plain'}<Badge tone="neutral">{m.settings_forwarding_badge_plain()}</Badge>{/if}
			{/snippet}
			<div class="rec-dest">
				<Icon icon={faArrowRight} size={12} />
				<span class="mono rec-to">{d.destination}</span>
				{#if keyLine(d)}
					<span class="rec-dot">·</span>
					<span class="mono rec-key">{keyLine(d)}</span>
				{/if}
			</div>
			{#if deliveryText(d)}
				<div class="rec-delivery" style:color={deliveryColor(d)}>{deliveryText(d)}</div>
			{/if}
			{#snippet actions()}
				{#if d.state !== 'revoked'}
					<div class="rec-actions">
						{#if d.state === 'pending_verification'}
							<Button
								variant="ghost"
								size="sm"
								disabled={busyId === d.id || !!blocked}
								onclick={() =>
									run(
										d,
										() => readDelegations.resend(addressId, d.id),
										m.settings_forwarding_resend_done({ destination: d.destination })
									)}
							>
								<Icon icon={faEnvelope} size={13} />{m.settings_forwarding_resend()}
							</Button>
						{/if}
						{#if d.state === 'active'}
							<Button
								variant="ghost"
								size="sm"
								disabled={busyId === d.id}
								onclick={() =>
									run(
										d,
										() => readDelegations.pause(addressId, d.id),
										m.settings_forwarding_paused_done({ label: d.label })
									)}
							>
								<Icon icon={faPause} size={13} />{m.settings_forwarding_pause()}
							</Button>
						{:else if d.state === 'paused'}
							<Button
								variant="ghost"
								size="sm"
								disabled={busyId === d.id || !!blocked}
								onclick={() =>
									run(
										d,
										() => readDelegations.resume(addressId, d.id),
										m.settings_forwarding_resumed_done({ label: d.label })
									)}
							>
								<Icon icon={faPlay} size={13} />{m.settings_forwarding_resume()}
							</Button>
						{/if}
						<div class="addr-menu-wrap">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="ghost" size="icon-sm" aria-label={m.settings_forwarding_actions()}>
											<Icon icon={faEllipsis} size={16} />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									{#if d.mode !== 'plain' && !blocked}
										<DropdownMenu.Item onSelect={() => (rotating = d)}>
											<Icon icon={faRotateRight} size={15} />{m.settings_forwarding_replace_key()}
										</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Item variant="danger" onSelect={() => (revoking = d)}>
										<Icon icon={faTrashCan} size={15} />{m.settings_forwarding_turn_off()}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					</div>
				{/if}
			{/snippet}
		</RecordRow>
	{/each}

	{#if items.length === 0 && !readDelegations.loading}
		<div class="card-empty">{m.settings_forwarding_empty()}</div>
	{/if}

	{#if readDelegations.error}
		<div class="card-empty err">{readDelegations.error}</div>
	{/if}

	{#if !billing.canAddDomains}
		<UpgradeNudge
			title={m.settings_forwarding_upgrade_title()}
			desc={m.settings_forwarding_upgrade_desc()}
		/>
	{/if}
</Card>

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
		onRevoked={(label) => (flash = m.settings_forwarding_revoked_done({ label }))}
	/>
{/if}
