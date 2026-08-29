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
		canSend,
		nextStep,
		ownershipProven,
		previousStep,
		stepComplete,
		type DomainStep
	} from './steps';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { canManageWorkspace } from '../permissions';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import type { CustomDomain, RequiredDNSRecord } from '$lib/api/customDomains';

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

	function stop() {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	async function check() {
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		checking = true;
		try {
			await customDomains.verify(ws, domain.id);
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not check DNS';
		} finally {
			checking = false;
		}
	}

	$effect(() => {
		const s = step;
		stop();
		attempts = 0;
		if (!STEP_PHASE[s]) return;

		let cancelled = false;
		const tick = async () => {
			await check();
			if (cancelled || stepComplete(domain, s)) return;
			const delay = POLL_DELAYS_MS[attempts] ?? HEARTBEAT_MS;
			attempts += 1;
			timer = setTimeout(() => void tick(), delay);
		};
		if (!untrack(() => stepComplete(domain, s))) void tick();

		return () => {
			cancelled = true;
			stop();
		};
	});
</script>

<WizardRail current={step} done={(s) => stepComplete(domain, s)} onSelect={onStep} />

<Card>
	{#snippet head()}
		{#if step === 'ownership'}
			<Info size={16} /><h3>Prove you own {domain.domain}</h3>
		{:else if step === 'sending'}
			<Info size={16} /><h3>Let {domain.domain} send mail</h3>
		{:else if step === 'recipients'}
			<AtSign size={16} /><h3>Add the people who will receive mail</h3>
		{:else if step === 'routing'}
			<TriangleAlert size={16} /><h3>Point mail at Thelemail</h3>
		{:else}
			<CircleCheck size={16} /><h3>Setup complete</h3>
		{/if}
	{/snippet}

	<div class="dw-pane">
		{#if step === 'ownership'}
			<p class="dw-lede">
				Add this TXT record at your registrar. It proves you control the domain and nothing else
				changes: mail keeps flowing wherever it flows today.
			</p>
			<RecordList records={phaseRecords} />
			{#if ownershipProven(domain)}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>Ownership confirmed.</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						DNS usually propagates within a few minutes, sometimes a few hours. You can close this
						page. We keep checking, and the domain moves on by itself.
					</span>
				</div>
			{/if}
		{:else if step === 'sending'}
			<p class="dw-lede">
				These records let Thelemail sign and send mail as <b>{domain.domain}</b>. Adding them does
				not redirect incoming mail.
			</p>
			<RecordList records={phaseRecords} />
			{#if canSend(domain)}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>Sending records confirmed.</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						DNS usually propagates within a few minutes, sometimes a few hours. You can close this
						page. We keep checking, and the domain moves on by itself.
					</span>
				</div>
			{/if}
		{:else if step === 'recipients'}
			<p class="dw-lede">
				Create the addresses that should receive mail <b>before</b> you change MX. Mail sent to an
				address that does not exist yet bounces, and a bounce is not recoverable.
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
					<TriangleAlert size={15} /><span>No addresses on this domain yet.</span>
				</div>
			{/if}
			<div class="dw-addr-acts">
				<button
					type="button"
					class="btn btn-secondary"
					disabled={!manage}
					onclick={() => (addingAlias = true)}
				>
					<Plus size={14} />Add an address
				</button>
			</div>
			<div class="dw-note">
				<Info size={15} />
				<span>
					Colleagues get their address by invitation. Invite them from Members, then come back
					here.
				</span>
			</div>
		{:else if step === 'routing'}
			<p class="dw-lede">
				This is the cutover. Once this MX record is live, mail for <b>{domain.domain}</b> stops going
				to your old provider and arrives here instead. Remove any other MX records for the domain.
			</p>
			{#if domain.addressCount === 0}
				<div class="dw-note bad">
					<TriangleAlert size={15} />
					<span>
						<b>There are no addresses on this domain.</b> If you change MX now, every message sent
						to it will bounce.
						<button type="button" class="dw-link" onclick={() => onStep('recipients')}>
							Add an address first
						</button>
					</span>
				</div>
			{/if}
			<RecordList records={phaseRecords} />
			{#if domain.mxVerifiedAt}
				<div class="dw-note ok">
					<CircleCheck size={15} /><span>Mail is routing here.</span>
				</div>
			{:else}
				<div class="dw-note">
					<Clock size={15} />
					<span>
						DNS usually propagates within a few minutes, sometimes a few hours. You can close this
						page. We keep checking, and the domain moves on by itself.
					</span>
				</div>
			{/if}
		{:else}
			<div class="dw-done">
				<span class="dw-done-ic"><CircleCheck size={34} strokeWidth={1.6} /></span>
				<h4 class="dw-done-title">{domain.domain} is live</h4>
				<p class="dw-done-desc">
					Mail addressed to it arrives here, and mail sent from it is signed. We keep watching the
					records and will flag it if anything changes.
				</p>
				<div class="dw-done-stats">
					{#each LADDER as s (s)}
						<span class="dw-done-stat"><Check size={13} strokeWidth={2.5} />{STEP_LABELS[s]}</span>
					{/each}
					<span class="dw-done-stat">
						<Check size={13} strokeWidth={2.5} />{domain.addressCount} address{domain.addressCount ===
						1
							? ''
							: 'es'}
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
			<button type="button" class="btn btn-ghost" onclick={() => onStep(previousStep(step))}>
				<ArrowLeft size={15} />Back
			</button>
		{/if}
		<span class="dw-spacer"></span>
		{#if phase}
			<button type="button" class="btn btn-secondary" disabled={checking || !manage} onclick={() => void check()}>
				<RefreshCw size={14} />{checking ? 'Checking…' : 'Check now'}
			</button>
		{/if}
		{#if step === 'done'}
			<a class="btn btn-primary" href={listHref}>All domains<ArrowRight size={15} /></a>
		{:else}
			<button type="button" class="btn btn-primary" onclick={() => onStep(nextStep(step))}>
				Continue<ArrowRight size={15} />
			</button>
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


