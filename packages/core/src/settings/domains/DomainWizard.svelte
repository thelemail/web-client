<script lang="ts">
	import { untrack } from 'svelte';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Clock from '@lucide/svelte/icons/clock';
	import Info from '@lucide/svelte/icons/info';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	import Card from '../Card.svelte';
	import RecordList from './RecordList.svelte';
	import WizardRail from './WizardRail.svelte';
	import {
		DOMAIN_STEPS,
		STEP_LABELS,
		STEP_PHASE,
		nextStep,
		ownershipVerified,
		previousStep,
		sendingVerified,
		stepComplete,
		stepReachable,
		type DomainStep
	} from './steps';
	import { addresses } from '$core/stores/addresses.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { canManageWorkspace } from '../permissions';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import type { CustomDomain, RequiredDNSRecord } from '$core/api/customDomains';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		domain: CustomDomain;
		records: RequiredDNSRecord[];
		step: DomainStep;
		listHref: string;
		onStep: (s: DomainStep) => void;
	}

	let { domain, records, step, listHref, onStep }: Props = $props();

	const POLL_DELAYS_MS = [2000, 3000, 5000, 10000, 15000, 30000];
	const HEARTBEAT_MS = 60000;

	let checking = $state(false);
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let attempts = 0;

	let addingAddress = $state(false);
	let addressError = $state<string | null>(null);

	const LADDER = DOMAIN_STEPS.filter((s) => s !== 'done');

	const phase = $derived(STEP_PHASE[step]);
	const phaseRecords = $derived(phase ? records.filter((r) => r.phase === phase) : []);
	const manage = $derived(canManageWorkspace());
	let addingAlias = $state(false);
	const domainAddresses = $derived(addresses.items.filter((a) => a.customDomainId === domain.id));

	const domainId = $derived(domain.id);

	function stop() {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	async function check(id: string) {
		if (checking) return;
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		checking = true;
		try {
			await customDomains.verify(ws, id);
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : m.settings_domains_wizard_check_failed();
		} finally {
			checking = false;
		}
	}

	$effect(() => {
		const s = step;
		const id = domainId;
		stop();
		attempts = 0;
		if (!STEP_PHASE[s]) return;

		let cancelled = false;
		const tick = async () => {
			await check(id);
			if (cancelled || stepComplete(domain, s)) return;
			const delay = POLL_DELAYS_MS[attempts] ?? HEARTBEAT_MS;
			attempts += 1;
			timer = setTimeout(() => void tick(), delay);
		};
		untrack(() => {
			if (!stepComplete(domain, s)) void tick();
		});

		return () => {
			cancelled = true;
			stop();
		};
	});
</script>

<WizardRail
	current={step}
	done={(s) => stepComplete(domain, s)}
	reachable={(s) => stepReachable(domain, s)}
	onSelect={onStep}
/>

<Card>
	{#snippet head()}
		{#if step === 'ownership'}
			<Info size={16} /><h3>{m.settings_domains_wizard_ownership_title({ domain: domain.domain })}</h3>
		{:else if step === 'sending'}
			<Info size={16} /><h3>{m.settings_domains_wizard_sending_title({ domain: domain.domain })}</h3>
		{:else if step === 'recipients'}
			<AtSign size={16} /><h3>{m.settings_domains_wizard_recipients_title()}</h3>
		{:else if step === 'routing'}
			<TriangleAlert size={16} /><h3>{m.settings_domains_wizard_routing_title()}</h3>
		{:else}
			<CircleCheck size={16} /><h3>{m.settings_domains_wizard_done_title()}</h3>
		{/if}
	{/snippet}

	<div class="dw-pane">
		{#if step === 'ownership'}
			<p class="dw-lede">
				{m.settings_domains_wizard_ownership_lede()}
			</p>
			<RecordList records={phaseRecords} />
			{#if ownershipVerified(domain)}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>{m.settings_domains_wizard_ownership_ok()}</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						{m.settings_domains_wizard_propagation()}
					</span>
				</div>
			{/if}
		{:else if step === 'sending'}
			<p class="dw-lede">
				<Rich text={m.settings_domains_wizard_sending_lede({ domain: domain.domain })} tags={{ b: bold }} />
			</p>
			<RecordList records={phaseRecords} />
			{#if sendingVerified(domain)}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>{m.settings_domains_wizard_sending_ok()}</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						{m.settings_domains_wizard_propagation()}
					</span>
				</div>
			{/if}
		{:else if step === 'recipients'}
			<p class="dw-lede">
				<Rich text={m.settings_domains_wizard_recipients_lede()} tags={{ b: bold }} />
			</p>
			{#if domainAddresses.length > 0}
				<div class="dw-addrs">
					{#each domainAddresses as a (a.id)}
						<div class="dw-addr">
							<AtSign size={14} />
							<span class="mono">{a.email}</span>
							{#if a.name}<span>{a.name}</span>{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="dw-note warn">
					<TriangleAlert size={15} /><span>{m.settings_domains_wizard_no_addresses()}</span>
				</div>
			{/if}
			<div class="dw-addr-acts">
				<Button variant="secondary" disabled={!manage} onclick={() => (addingAlias = true)}>
					<Plus size={14} />{m.settings_domains_wizard_add_address()}
				</Button>
			</div>
			<div class="dw-note">
				<Info size={15} />
				<span>
					{m.settings_domains_wizard_invite_note()}
				</span>
			</div>
		{:else if step === 'routing'}
			<p class="dw-lede">
				<Rich text={m.settings_domains_wizard_routing_lede({ domain: domain.domain })} tags={{ b: bold }} />
			</p>
			{#if domain.addressCount === 0}
				<div class="dw-note bad">
					<TriangleAlert size={15} />
					<span>
						<Rich
							text={m.settings_domains_wizard_routing_no_addresses()}
							tags={{ b: bold, link: recipientsLink }}
						/>
					</span>
				</div>
			{/if}
			<RecordList records={phaseRecords} />
			{#if domain.mxVerifiedAt}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>{m.settings_domains_wizard_routing_ok()}</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						{m.settings_domains_wizard_propagation()}
					</span>
				</div>
			{/if}
		{:else}
			<div class="dw-done">
				<span class="dw-done-ic"><CircleCheck size={34} strokeWidth={1.6} /></span>
				<h4 class="dw-done-title">{m.settings_domains_wizard_live({ domain: domain.domain })}</h4>
				<p class="dw-done-desc">
					{m.settings_domains_wizard_done_desc()}
				</p>
				<div class="dw-done-stats">
					{#each LADDER as s (s)}
						<span class="dw-done-stat"><Check size={13} strokeWidth={2.5} />{STEP_LABELS[s]()}</span>
					{/each}
					<span class="dw-done-stat">
						<Check size={13} strokeWidth={2.5} />{m.settings_domains_wizard_address_count({
							count: domain.addressCount
						})}
					</span>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="dw-note bad"><CircleAlert size={15} /><span>{error}</span></div>
		{:else if domain.lastError && step !== 'done'}
			<div class="dw-note warn"><CircleAlert size={15} /><span>{domain.lastError}</span></div>
		{/if}
	</div>

	<div class="dw-foot">
		{#if step !== 'ownership'}
			<Button variant="ghost" onclick={() => onStep(previousStep(step))}>
				<ArrowLeft size={15} />{m.common_back()}
			</Button>
		{/if}
		<span class="dw-spacer"></span>
		{#if phase}
			<Button variant="secondary" disabled={checking || !manage} onclick={() => void check(domainId)}>
				<RefreshCw size={14} />{checking ? m.settings_domains_wizard_checking() : m.settings_domains_wizard_check_now()}
			</Button>
		{/if}
		{#if step === 'done'}
			<Button variant="primary" href={listHref}>{m.settings_domains_wizard_all_domains()}<ArrowRight size={15} /></Button>
		{:else}
			<Button variant="primary" disabled={!stepReachable(domain, nextStep(step))} onclick={() => onStep(nextStep(step))}>
				{m.common_continue()}<ArrowRight size={15} />
			</Button>
		{/if}
	</div>
</Card>
{#if addingAlias}
	<AliasCeremony
		mode="create"
		presetDomainId={domain.id}
		onClose={() => (addingAlias = false)}
		onComplete={() => {
			const ws = workspaces.workspace?.id;
			if (ws) void customDomains.fetchDetail(ws, domain.id);
		}}
	/>
{/if}

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

{#snippet recipientsLink(t: string)}<button type="button" class="dw-link" onclick={() => onStep('recipients')}>{t}</button>{/snippet}
