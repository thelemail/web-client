<script lang="ts">
	import Globe from '@lucide/svelte/icons/globe';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import Clock from '@lucide/svelte/icons/clock';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import CopyBtn from '../CopyBtn.svelte';
	import DnsChip from '../DnsChip.svelte';
	import type { CeremonyKind } from '../data';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type {
		CustomDomainWithRecords,
		DNSRecordStatus,
		RequiredDNSRecord
	} from '$lib/api/customDomains';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	const steps = ['Domain', 'Add records', 'Verify', 'Done'];
	let step = $state(0);
	let name = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let detail = $state<CustomDomainWithRecords | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let pollAttempts = $state(0);
	let pollStopReason = $state<'verified' | 'timeout' | null>(null);

	const POLL_DELAYS_MS = [1500, 2500, 5000, 10000, 15000, 15000, 15000, 30000, 30000, 30000];

	const clean = $derived(
		name
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/\/.*$/, '')
			.replace(/\.$/, '')
	);
	const valid = $derived(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(clean));

	async function submit() {
		if (!valid || submitting) return;
		const ws = workspaces.workspace?.id;
		if (!ws) {
			submitError = 'No workspace loaded — refresh the page and try again.';
			return;
		}
		submitting = true;
		submitError = null;
		try {
			const created = await customDomains.create(ws, clean);
			detail = created;
			step = 1;
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Could not add domain';
		} finally {
			submitting = false;
		}
	}

	function startPolling() {
		stopPolling();
		pollAttempts = 0;
		pollStopReason = null;
		step = 2;
		void pollOnce(false);
	}

	function stopPolling() {
		if (pollTimer !== undefined) {
			clearTimeout(pollTimer);
			pollTimer = undefined;
		}
	}

	async function pollOnce(manual: boolean) {
		const ws = workspaces.workspace?.id;
		const d = detail;
		if (!ws || !d) return;
		try {
			const result = await customDomains.verify(ws, d.domain.id);
			detail = result;
			if (result.domain.status === 'verified') {
				pollStopReason = 'verified';
				stopPolling();
				step = 3;
				return;
			}
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Verify failed';
		}
		if (manual) return;
		pollAttempts += 1;
		if (pollAttempts >= POLL_DELAYS_MS.length) {
			pollStopReason = 'timeout';
			stopPolling();
			return;
		}
		const delay = POLL_DELAYS_MS[pollAttempts];
		pollTimer = setTimeout(() => void pollOnce(false), delay);
	}

	async function manualRecheck() {
		await pollOnce(true);
	}

	function finishOnTimeout() {
		onComplete('domain');
		onClose();
	}

	$effect(() => {
		return () => stopPolling();
	});

	function chipKind(s: DNSRecordStatus): 'ok' | 'warn' | 'fail' | 'pending' {
		switch (s) {
			case 'ok':
				return 'ok';
			case 'missing':
				return 'pending';
			case 'mismatch':
				return 'fail';
			default:
				return 'pending';
		}
	}

	function recordLabel(r: RequiredDNSRecord): string {
		switch (r.kind) {
			case 'ownership':
				return 'Ownership';
			case 'mx':
				return 'Inbound (MX)';
			case 'dkim':
				return 'DKIM';
			case 'spf':
				return 'SPF';
			case 'dmarc':
				return 'DMARC';
			default:
				return r.kind;
		}
	}

	const liveDomain = $derived(detail?.domain ?? null);
	const liveRecords = $derived(detail?.records ?? []);
</script>

<CeremonyShell
	icon={Globe}
	eyebrow="Domains"
	title="Add a domain"
	{steps}
	{step}
	hideFooter={step === 2 && pollStopReason === null}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Connect a domain you already own. You'll add a few DNS records at your registrar — we
					generate them for you — then we verify. <b>Your domain stays yours.</b>
				</p>
			</div>
			<div class="field">
				<label for="add-domain-name">Domain name</label>
				<div class="input-prefix">
					<span class="ip-ic"><Globe size={16} /></span>
					<input
						id="add-domain-name"
						class="tin mono"
						bind:value={name}
						placeholder="example.com"
						autocomplete="off"
					/>
				</div>
				{#if name.length > 0 && !valid}
					<div class="field-hint bad">
						<CircleAlert size={13} />Enter a bare domain like
						<span class="mono">example.com</span> — no <span class="mono">http://</span> or paths.
					</div>
				{/if}
				{#if submitError}
					<div class="field-hint bad">
						<CircleAlert size={13} />{submitError}
					</div>
				{/if}
			</div>
			<div class="inline-warn">
				<Info size={15} />
				<span
					>You'll need access to this domain's DNS settings at your registrar (where you bought it).</span
				>
			</div>
		</div>
	{:else if step === 1}
		<div class="cer-pane">
			<div class="cer-instruct">
				Open the DNS settings for
				<b class="mono">{liveDomain?.domain ?? clean}</b>
				at your registrar and add these records. Values are exact — use
				<b>Copy</b> on each so nothing is mistyped.
			</div>
			<div class="cd-records">
				{#each liveRecords as r (r.kind + r.host)}
					<div class="rec-row">
						<div class="rec-head">
							<span class="rec-type">{recordLabel(r)}</span>
							<span class="rec-kind">{r.type}</span>
							<span class="rec-meta">
								Host <code>{r.host}</code>
								{#if !r.required}· optional{/if}
							</span>
							<CopyBtn text={r.value} small />
						</div>
						<div class="rec-val"><code>{r.value}</code></div>
					</div>
				{/each}
			</div>
			<div class="inline-warn">
				<Clock size={15} />
				<span>
					DNS can take a few minutes to propagate (occasionally up to a few hours). You can close
					this and we'll keep checking in the background.
				</span>
			</div>
		</div>
	{:else if step === 2}
		<div class="cer-pane">
			{#if pollStopReason === 'timeout'}
				<div class="cer-instruct">
					DNS hasn't propagated yet. We'll keep checking in the background — your domain will
					appear as verified once the records are visible. You can close this and come back, or
					retry now.
				</div>
			{:else}
				<div class="cer-instruct">Checking DNS for <b class="mono">{liveDomain?.domain ?? clean}</b>…</div>
			{/if}
			<div class="cd-records">
				{#each liveRecords as r (r.kind + r.host)}
					<div class="rec-row compact">
						<span class="rec-type">{recordLabel(r)}</span>
						<span class="rec-kind">{r.type}</span>
						<DnsChip kind={chipKind(r.status)} />
					</div>
				{/each}
			</div>
			{#if submitError}
				<div class="field-hint bad">
					<CircleAlert size={13} />{submitError}
				</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={CircleCheck}
			title="Domain verified"
			desc={"We've confirmed all the required records for " + (liveDomain?.domain ?? clean) + '.'}
		>
			<div class="cer-reminder">
				<Info size={15} />Routing mail through this domain is rolling out next — we'll let you
				know.
			</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={!valid || submitting}
				onclick={submit}
			>
				{submitting ? 'Adding…' : 'Continue'}<ArrowRight size={15} />
			</button>
		{:else if step === 1}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Save & close</button>
			<button type="button" class="btn btn-primary" onclick={startPolling}>
				I've added the records<ArrowRight size={15} />
			</button>
		{:else if step === 2 && pollStopReason === 'timeout'}
			<button type="button" class="btn btn-ghost" onclick={finishOnTimeout}>Close</button>
			<button type="button" class="btn btn-secondary" onclick={() => (step = 1)}>
				<ArrowLeft size={15} />Back to records
			</button>
			<button type="button" class="btn btn-primary" onclick={manualRecheck}>
				<RefreshCw size={14} />Re-check now
			</button>
		{:else if step === 3}
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => {
					onComplete('domain');
					onClose();
				}}>Done</button
			>
		{/if}
	{/snippet}
</CeremonyShell>

<style>
	.cd-records {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 12px 0;
	}
	.rec-row.compact {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 12px;
		align-items: center;
		padding: 8px 12px;
		border: 1px solid var(--line, rgba(0, 0, 0, 0.08));
		border-radius: 6px;
		font-size: 13px;
	}
	.rec-row.compact .rec-type {
		font-weight: 500;
	}
	.rec-row.compact .rec-kind {
		font-size: 11px;
		color: var(--ink-2, rgba(0, 0, 0, 0.5));
	}
</style>
