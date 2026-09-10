<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import X from '@lucide/svelte/icons/x';
	import type { DnsState } from './types';

	interface Props {
		kind: DnsState;
		label?: string;
	}

	let { kind, label }: Props = $props();

	const Icon = $derived(
		kind === 'ok' ? Check : kind === 'warn' ? TriangleAlert : kind === 'pending' ? Clock : X
	);
	const txt = $derived(label ?? kind.toUpperCase());
</script>

<span class={'dns-chip d-' + kind}>
	<Icon size={12} />{txt}
</span>
