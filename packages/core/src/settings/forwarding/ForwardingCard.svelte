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
	}

	let { addressId, email }: Props = $props();

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
		if (d.mode === 'plain') return 'readable, no key';
		return d.encryptionKeyFingerprint ? shortFingerprint(d.encryptionKeyFingerprint) : '';
	}

	function deliveryText(d: ReadDelegation): string {
		const summary = summarise(d);
		if (summary.latest) {
			let out = `Last message: ${deliveryLabel(summary.latest.status)}`;
			if (summary.failed || summary.skipped) {
				out += ` · ${summary.delivered} delivered, ${summary.failed} not delivered, ${summary.skipped} not forwarded recently`;
			}
			return out;
		}
		if (d.state === 'active') return 'Nothing forwarded yet.';
		if (d.state === 'pending_verification') {
			return `Waiting for someone at ${d.destination} to use the confirmation link.`;
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
			flash = err instanceof Error ? err.message : 'That did not work. Try again.';
		} finally {
			busyId = null;
		}
	}
</script>

<svelte:window onclick={dismiss} />

<div class="scard menus">
	<CardHead icon={Forward} title="Forwarding">
		{#snippet right()}
			<span class="card-meta">
				{live.length}
				{live.length === 1 ? 'destination' : 'destinations'}
			</span>
			{#if billing.canAddDomains}
				<Button variant="secondary" size="sm" onclick={() => (creating = true)}>
					<Plus size={13} />Forward to a system
				</Button>
			{/if}
		{/snippet}
	</CardHead>

	<div class="card-lede">
		Send new mail for {email} somewhere else: a system you hand a key to, or an ordinary mailbox
		that receives it readable. Only mail arriving after the destination is confirmed is forwarded.
	</div>

	{#if flash}
		<div class="card-flash"><Check size={14} />{flash}</div>
	{/if}

	{#each items as d (d.id)}
		<div class="rec-row top">
			<div class="rec-main">
				<div class="rec-title">
					<span class="rec-label">{d.label}</span>
					{#if d.state === 'active'}
						<Badge kind="ok" dot>Forwarding</Badge>
					{:else if d.state === 'pending_verification'}
						<Badge kind="info" dot>Waiting for confirmation</Badge>
					{:else if d.state === 'paused'}
						<Badge kind="neutral" dot>Paused</Badge>
					{:else}
						<Badge kind="warn" dot>Turned off</Badge>
					{/if}
					{#if d.mode === 'plain'}<Badge kind="neutral">Plain text</Badge>{/if}
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
							disabled={busyId === d.id}
							onclick={() =>
								run(
									d,
									() => readDelegations.resend(addressId, d.id),
									`A new link is on its way to ${d.destination}.`
								)}
						>
							<Mail size={13} />Send link again
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
									`Forwarding to ${d.label} is paused.`
								)}
						>
							<Pause size={13} />Pause
						</Button>
					{:else if d.state === 'paused'}
						<Button
							variant="ghost"
							size="sm"
							disabled={busyId === d.id}
							onclick={() =>
								run(
									d,
									() => readDelegations.resume(addressId, d.id),
									`Forwarding to ${d.label} is back on.`
								)}
						>
							<Play size={13} />Resume
						</Button>
					{/if}
					<div class="addr-menu-wrap">
						<button
							type="button"
							class="rowmenu"
							aria-label="Forwarding actions"
							aria-expanded={menuFor === d.id}
							onclick={() => (menuFor = menuFor === d.id ? null : d.id)}
						>
							<Ellipsis size={16} />
						</button>
						{#if menuFor === d.id}
							<div class="addr-menu" role="menu">
								{#if d.mode !== 'plain'}
									<button
										type="button"
										class="mitem"
										onclick={() => {
											menuFor = null;
											rotating = d;
										}}
									>
										<RotateCw size={15} />Replace the key
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
									<Trash2 size={15} />Turn off
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/each}

	{#if items.length === 0 && !readDelegations.loading}
		<div class="card-empty">Mail to this address is not forwarded anywhere.</div>
	{/if}

	{#if readDelegations.error}
		<div class="card-empty err">{readDelegations.error}</div>
	{/if}

	{#if !billing.canAddDomains}
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
