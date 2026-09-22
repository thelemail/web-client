<script lang="ts">
	import Forward from '@lucide/svelte/icons/forward';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Mail from '@lucide/svelte/icons/mail';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Info from '@lucide/svelte/icons/info';

	import { m } from '$paraglide/messages.js';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import ForwardingCeremony from './ForwardingCeremony.svelte';
	import RevokeForwardingDialog from './RevokeForwardingDialog.svelte';
	import { deliveryLabel, deliveryTone, summarise } from './deliveryStatus';
	import { Button } from '$core/components/ui/button';
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
	let menuFor = $state<string | null>(null);

	const items = $derived(readDelegations.for(addressId));
	const live = $derived(items.filter((d) => d.state !== 'revoked'));

	$effect(() => {
		void readDelegations.load(addressId);
	});

	function shortFingerprint(fp: string): string {
		return fp.slice(0, 16).replace(/(.{4})/g, '$1 ').trim().toUpperCase();
	}

	function keyLine(d: ReadDelegation): string {
		if (d.mode === 'plain') return m.settings_forwarding_key_plain();
		return d.encryptionKeyFingerprint ? shortFingerprint(d.encryptionKeyFingerprint) : '';
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

	function dismiss(e: Event) {
		if (menuFor === null) return;
		const t = e.target;
		if (t instanceof Element && t.closest('.addr-menu-wrap')) return;
		menuFor = null;
	}

	async function run(d: ReadDelegation, action: () => Promise<void>, done: string) {
		menuFor = null;
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

<svelte:window onclick={dismiss} />

<div class="scard menus">
	<CardHead icon={Forward} title={m.settings_forwarding_title()}>
		{#snippet right()}
			<span class="card-meta">
				{m.settings_forwarding_destinations({ count: live.length })}
			</span>
			{#if billing.canAddDomains}
				<Button
					variant="secondary"
					size="sm"
					disabled={!!blocked}
					onclick={() => (creating = true)}
				>
					<Plus size={13} />{m.settings_forwarding_add()}
				</Button>
			{/if}
		{/snippet}
	</CardHead>

	<div class="card-lede">
		{m.settings_forwarding_lede({ email })}
	</div>

	{#if blocked}
		<div class="card-note"><Info size={14} />{blocked}</div>
	{/if}

	{#if flash}
		<div class="card-flash"><Check size={14} />{flash}</div>
	{/if}

	{#each items as d (d.id)}
		<div class="rec-row top">
			<div class="rec-main">
				<div class="rec-title">
					<span class="rec-label">{d.label}</span>
					{#if d.state === 'active'}
						<Badge kind="ok" dot>{m.settings_forwarding_badge_active()}</Badge>
					{:else if d.state === 'pending_verification'}
						<Badge kind="info" dot>{m.settings_forwarding_badge_pending()}</Badge>
					{:else if d.state === 'paused'}
						<Badge kind="neutral" dot>{m.settings_forwarding_badge_paused()}</Badge>
					{:else}
						<Badge kind="warn" dot>{m.settings_forwarding_badge_off()}</Badge>
					{/if}
					{#if d.mode === 'plain'}<Badge kind="neutral">{m.settings_forwarding_badge_plain()}</Badge>{/if}
				</div>
				<div class="rec-dest">
					<ArrowRight size={12} />
					<span class="mono rec-to">{d.destination}</span>
					{#if keyLine(d)}
						<span class="rec-dot">·</span>
						<span class="mono rec-key">{keyLine(d)}</span>
					{/if}
				</div>
				{#if deliveryText(d)}
					<div class="rec-delivery" style:color={deliveryColor(d)}>{deliveryText(d)}</div>
				{/if}
			</div>
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
							<Mail size={13} />{m.settings_forwarding_resend()}
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
							<Pause size={13} />{m.settings_forwarding_pause()}
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
							<Play size={13} />{m.settings_forwarding_resume()}
						</Button>
					{/if}
					<div class="addr-menu-wrap">
						<button
							type="button"
							class="rowmenu"
							aria-label={m.settings_forwarding_actions()}
							aria-expanded={menuFor === d.id}
							onclick={() => (menuFor = menuFor === d.id ? null : d.id)}
						>
							<Ellipsis size={16} />
						</button>
						{#if menuFor === d.id}
							<div class="addr-menu" role="menu">
								{#if d.mode !== 'plain' && !blocked}
									<button
										type="button"
										class="mitem"
										onclick={() => {
											menuFor = null;
											rotating = d;
										}}
									>
										<RotateCw size={15} />{m.settings_forwarding_replace_key()}
									</button>
								{/if}
								<button
									type="button"
									class="mitem danger"
									onclick={() => {
										menuFor = null;
										revoking = d;
									}}
								>
									<Trash2 size={15} />{m.settings_forwarding_turn_off()}
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
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
		onRevoked={(label) => (flash = m.settings_forwarding_revoked_done({ label }))}
	/>
{/if}
