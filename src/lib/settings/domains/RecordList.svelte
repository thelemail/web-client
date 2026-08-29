<script lang="ts">
	import CopyBtn from '../CopyBtn.svelte';
	import DnsChip from '../DnsChip.svelte';
	import type { DNSRecordKind, DNSRecordStatus, RequiredDNSRecord } from '$lib/api/customDomains';

	interface Props {
		records: RequiredDNSRecord[];
	}

	let { records }: Props = $props();

	const LABEL: Record<DNSRecordKind, string> = {
		ownership: 'OWNERSHIP',
		mx: 'MX',
		dkim: 'DKIM',
		spf: 'SPF',
		dmarc: 'DMARC',
		wkd: 'WKD'
	};

	const PURPOSE: Record<DNSRecordKind, string> = {
		ownership:
			'Proves the domain is yours. Without it anyone pointing DNS at Thelemail could claim it.',
		dkim: 'Signs your outgoing mail so recipients can tell it really came from you. Two records so we can rotate keys without you touching DNS again.',
		spf: 'Tells other providers that Thelemail is allowed to send as this domain. Missing it sends your mail to spam.',
		dmarc: 'Tells other providers what to do with mail that fails the checks above, and gets you the reports.',
		wkd: 'Publishes your public keys at a standard address, so people on Proton and other OpenPGP clients can encrypt to you without asking for a key first. Skip it and mail still works, you just lose automatic encryption from outside Thelemail.',
		mx: 'Points incoming mail at Thelemail. This is the cutover: until you add it, mail keeps going to your current provider.'
	};

	const firstOfKind = $derived(
		new Set(records.map((r) => records.find((c) => c.kind === r.kind)?.host + '|' + r.kind))
	);

	function chipKind(s: DNSRecordStatus): 'ok' | 'warn' | 'fail' | 'pending' {
		if (s === 'ok') return 'ok';
		if (s === 'mismatch') return 'fail';
		return 'pending';
	}
</script>

<div class="dw-recs">
	{#each records as r (r.kind + r.host)}
		<div class="dw-rec">
			<div class="dw-rec-head">
				<span class="dw-rec-type">{LABEL[r.kind]}</span>
				<span class="dw-rec-kind">{r.type}</span>
				<span class="dw-rec-meta">
					Host <code>{r.host}</code>
				</span>
				{#if !r.required}<span class="dw-opt">optional</span>{/if}
				<DnsChip kind={chipKind(r.status)} />
			</div>
			{#if firstOfKind.has(r.host + '|' + r.kind)}
				<p class="dw-rec-why">{PURPOSE[r.kind]}</p>
			{/if}
			<div class="dw-rec-val">
				<code>{r.value}</code>
				<CopyBtn text={r.value} small />
			</div>
		</div>
	{/each}
</div>
