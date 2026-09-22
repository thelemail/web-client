<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	import Card from '../Card.svelte';
	import CheckStatus from './CheckStatus.svelte';
	import RecordList from './RecordList.svelte';
	import WizardRail from './WizardRail.svelte';
	import { checkErrorMessage } from './errors';
	import { pollWhileVisible } from './poll';
	import {
		DOMAIN_STEPS,
		STEP_LABELS,
		STEP_PHASE,
		canRequestCheck,
		checkRunning,
		isDormant,
		nextStep,
		ownershipLapsing,
		previousStep,
		reasonMessage,
		reasonStage,
		stageCheckState,
		stepComplete,
		stepReachable,
		stepRunning,
		usable,
		type CheckStage,
		type DomainStep
	} from './steps';
	import { serverNow } from '$core/api/serverclock';
	import { addresses } from '$core/stores/addresses.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { dedupeAddresses } from '../addressModel';
	import { canManageWorkspace } from '../permissions';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import type { CustomDomain, RequiredDNSRecord } from '$core/api/customDomains';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { formatMoment } from '$core/i18n/relative';
	import { m } from '$paraglide/messages.js';

	interface Props {
		domain: CustomDomain;
		records: RequiredDNSRecord[];
		step: DomainStep;
		listHref: string;
		onStep: (s: DomainStep) => void;
	}

	let { domain, records, step, listHref, onStep }: Props = $props();

	const CHECK_POLL_MS = 30_000;
	const CLOCK_MS = 30_000;
	const LADDER = DOMAIN_STEPS.filter((s) => s !== 'done');

	let starting = $state(false);
	let startError = $state<{ stage: CheckStage; text: string } | null>(null);
	let now = $state(serverNow());
	let addingAlias = $state(false);

	const phase = $derived(STEP_PHASE[step]);
	const phaseRecords = $derived(phase ? records.filter((r) => r.phase === phase) : []);
	const manage = $derived(canManageWorkspace());
	const domainId = $derived(domain.id);
	const checkState = $derived(phase ? stageCheckState(domain, phase) : null);
	const mayCheck = $derived(!!phase && canRequestCheck(domain, phase, manage));
	const running = $derived(checkRunning(domain));
	const lapsing = $derived(ownershipLapsing(domain));
	const paused = $derived(isDormant(domain));
	const missingKind = $derived<'pending' | 'fail'>(
		checkState === 'expired' || (domain.status === 'failed' && !domain.check) ? 'fail' : 'pending'
	);
	const visibleAddresses = $derived(
		(manage ? dedupeAddresses([addresses.items, workspaceAddresses.items]) : addresses.items).filter(
			(a) => a.customDomainId === domain.id
		)
	);
	const startErrorText = $derived(startError && startError.stage === phase ? startError.text : null);
	const canContinue = $derived(stepComplete(domain, step) && stepReachable(domain, nextStep(step)));
	const lastErrorText = $derived(
		phase &&
			!domain.check &&
			domain.lastError &&
			(reasonStage(domain.lastError) ?? domain.actionableStage) === phase
			? reasonMessage(domain.lastError)
			: null
	);

	async function startCheck() {
		const stage = phase;
		const ws = workspaces.workspace?.id;
		if (starting || !stage || !ws) return;
		starting = true;
		startError = null;
		try {
			await customDomains.startCheck(ws, domainId, stage);
		} catch (err) {
			const text = checkErrorMessage(err, serverNow());
			startError = text ? { stage, text } : null;
		} finally {
			starting = false;
		}
	}

	$effect(() => {
		const t = setInterval(() => (now = serverNow()), CLOCK_MS);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (!running) return;
		const ws = workspaces.workspace?.id;
		const id = domainId;
		if (!ws) return;
		return pollWhileVisible(() => customDomains.fetchDetail(ws, id), CHECK_POLL_MS);
	});
</script>

<WizardRail
	current={step}
	done={(s) => stepComplete(domain, s)}
	reachable={(s) => stepReachable(domain, s)}
	running={(s) => stepRunning(domain, s)}
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
		{#if lapsing && domain.ownershipMissingSince && domain.releaseAt}
			<div class="dw-note bad">
				<TriangleAlert size={15} />
				<span>
					<Rich
						text={m.settings_domains_lapse_note({
							domain: domain.domain,
							since: formatMoment(domain.ownershipMissingSince),
							deadline: formatMoment(domain.releaseAt)
						})}
						tags={{ b: bold }}
					/>
				</span>
			</div>
		{:else if paused}
			<div class="dw-note warn">
				<Info size={15} /><span>{m.settings_domains_paused_note()}</span>
			</div>
		{/if}

		{#if step === 'ownership'}
			<p class="dw-lede">
				{m.settings_domains_wizard_ownership_lede()}
			</p>
			<RecordList records={phaseRecords} {now} missing={missingKind} />
			<CheckStatus {domain} stage="ownership" {now} {manage} canStart={mayCheck} />
		{:else if step === 'sending'}
			<p class="dw-lede">
				<Rich text={m.settings_domains_wizard_sending_lede({ domain: domain.domain })} tags={{ b: bold }} />
			</p>
			<RecordList records={phaseRecords} {now} missing={missingKind} />
			<CheckStatus {domain} stage="sending" {now} {manage} canStart={mayCheck} />
		{:else if step === 'recipients'}
			<p class="dw-lede">
				<Rich text={m.settings_domains_wizard_recipients_lede()} tags={{ b: bold }} />
			</p>
			{#if visibleAddresses.length > 0}
				<div class="dw-addrs">
					{#each visibleAddresses as a (a.id)}
						<div class="dw-addr">
							<AtSign size={14} />
							<span class="mono">{a.email}</span>
							{#if a.name}<span>{a.name}</span>{/if}
						</div>
					{/each}
				</div>
			{:else if domain.addressCount > 0}
				<div class="dw-note">
					<AtSign size={15} /><span>{m.settings_domains_wizard_address_count({ count: domain.addressCount })}</span>
				</div>
			{/if}
			{#if domain.addressCount === 0}
				<div class="dw-note warn">
					<TriangleAlert size={15} /><span>{m.settings_domains_wizard_no_addresses()}</span>
				</div>
			{/if}
			<div class="dw-addr-acts">
				<Button variant="secondary" disabled={!manage || !usable(domain)} onclick={() => (addingAlias = true)}>
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
			<RecordList records={phaseRecords} {now} missing={missingKind} />
			<CheckStatus {domain} stage="routing" {now} {manage} canStart={mayCheck} />
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

		{#if startErrorText}
			<div class="dw-note bad"><CircleAlert size={15} /><span>{startErrorText}</span></div>
		{:else if lastErrorText}
			<div class="dw-note warn"><CircleAlert size={15} /><span>{lastErrorText}</span></div>
		{/if}
	</div>

	<div class="dw-foot">
		{#if step !== 'ownership'}
			<Button variant="ghost" onclick={() => onStep(previousStep(step))}>
				<ArrowLeft size={15} />{m.common_back()}
			</Button>
		{/if}
		<span class="dw-spacer"></span>
		{#if mayCheck}
			<Button variant="secondary" disabled={starting} onclick={() => void startCheck()}>
				<RefreshCw size={14} />{starting ? m.settings_domains_wizard_checking() : m.settings_domains_wizard_check_dns()}
			</Button>
		{/if}
		{#if step === 'done'}
			<Button variant="primary" href={listHref}>{m.settings_domains_wizard_all_domains()}<ArrowRight size={15} /></Button>
		{:else}
			<Button variant="primary" disabled={!canContinue} onclick={() => onStep(nextStep(step))}>
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
			if (!ws) return;
			void customDomains.fetchDetail(ws, domain.id);
			if (manage) void workspaceAddresses.reload();
		}}
	/>
{/if}

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
