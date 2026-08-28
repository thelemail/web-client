<script lang="ts">
	import CopyBtn from '../CopyBtn.svelte';
	import DnsChip from '../DnsChip.svelte';
	import type { DNSRecordStatus, RequiredDNSRecord } from '$lib/api/customDomains';

	interface Props {
		records: RequiredDNSRecord[];
	}

	let { records }: Props = $props();

	function chipKind(s: DNSRecordStatus): 'ok' | 'warn' | 'fail' | 'pending' {
		if (s === 'ok') return 'ok';
		if (s === 'mismatch') return 'fail';
		return 'pending';
	}

	function label(r: RequiredDNSRecord): string {
		switch (r.kind) {
			case 'ownership':
				return 'OWNERSHIP';
			case 'mx':
				return 'MX';
			case 'dkim':
				return 'DKIM';
			case 'spf':
				return 'SPF';
			case 'dmarc':
				return 'DMARC';
			case 'wkd':
				return 'WKD';
		}
	}
</script>

<div class="dw-recs">
	{#each records as r (r.kind + r.host)}
		<div class="dw-rec">
			<div class="dw-rec-head">
				<span class="dw-rec-type">{label(r)}</span>
				<span class="dw-rec-kind">{r.type}</span>
				<span class="dw-rec-meta">
					Host <code>{r.host}</code>{#if !r.required}<span class="dw-opt"> optional</span>{/if}
				</span>
				<DnsChip kind={chipKind(r.status)} />
			</div>
			<div class="dw-rec-val">
				<code>{r.value}</code>
				<CopyBtn text={r.value} small />
			</div>
		</div>
	{/each}
</div>
