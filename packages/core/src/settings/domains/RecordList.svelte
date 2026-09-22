<script lang="ts">
	import CopyBtn from '../CopyBtn.svelte';
	import DnsChip from '../DnsChip.svelte';
	import type { DNSRecordKind, DNSRecordStatus, RequiredDNSRecord } from '$core/api/customDomains';
	import Rich from '$core/i18n/Rich.svelte';
	import { timeSince } from '$core/i18n/relative';
	import { m } from '$paraglide/messages.js';

	interface Props {
		records: RequiredDNSRecord[];
		now: number;
		missing?: 'pending' | 'fail';
	}

	let { records, now, missing = 'pending' }: Props = $props();

	const LABEL: Record<DNSRecordKind, string> = $derived({
		ownership: m.settings_domains_record_ownership(),
		mx: 'MX',
		dkim: 'DKIM',
		spf: 'SPF',
		dmarc: 'DMARC',
		wkd: 'WKD'
	});

	const PURPOSE: Record<DNSRecordKind, string> = $derived({
		ownership: m.settings_domains_purpose_ownership(),
		dkim: m.settings_domains_purpose_dkim(),
		spf: m.settings_domains_purpose_spf(),
		dmarc: m.settings_domains_purpose_dmarc(),
		wkd: m.settings_domains_purpose_wkd(),
		mx: m.settings_domains_purpose_mx()
	});

	const firstOfKind = $derived(
		new Set(records.map((r) => records.find((c) => c.kind === r.kind)?.host + '|' + r.kind))
	);

	function chipKind(s: DNSRecordStatus): 'ok' | 'warn' | 'fail' | 'pending' {
		if (s === 'ok') return 'ok';
		if (s === 'mismatch') return 'fail';
		return missing;
	}
</script>

<div class="dw-recs">
	{#each records as r (r.kind + r.host)}
		<div class="dw-rec">
			<div class="dw-rec-head">
				<span class="dw-rec-type">{LABEL[r.kind]}</span>
				<span class="dw-rec-kind">{r.type}</span>
				<span class="dw-rec-meta">
					<Rich text={m.settings_domains_record_host({ host: r.host })} tags={{ code }} />
				</span>
				{#if !r.required}<span class="dw-opt">{m.settings_domains_record_optional()}</span>{/if}
				{#if r.status === 'ok' && r.verifiedAt}
					<span class="dw-rec-when">{m.settings_domains_record_verified({ when: timeSince(r.verifiedAt, now) })}</span>
				{/if}
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

{#snippet code(t: string)}<code>{t}</code>{/snippet}
