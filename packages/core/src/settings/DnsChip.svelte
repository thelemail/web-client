<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faClock,
		faTriangleExclamation,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import type { DnsState } from './types';

	interface Props {
		kind: DnsState;
		label: string;
	}

	let { kind, label }: Props = $props();

	const glyph = $derived(
		kind === 'ok' ? faCheck : kind === 'warn' ? faTriangleExclamation : kind === 'pending' ? faClock : faXmark
	);
</script>

<span class={'dns-chip d-' + kind}>
	<Icon icon={glyph} size={12} />{label}
</span>
