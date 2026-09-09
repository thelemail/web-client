<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { page } from '$app/state';

	let { title, desc }: { title: string; desc: string } = $props();

	const href = $derived(`/u/${page.params.slot ?? '0'}/billing/choose`);
</script>

<a class="upgrade-nudge" {href}>
	<span class="up-ic"><Sparkles size={18} /></span>
	<span class="up-body">
		<span class="up-t">{title}</span>
		<span class="up-d">{desc}</span>
	</span>
	<ArrowRight size={16} />
</a>

<style>
	.up-body,
	.up-t,
	.up-d {
		display: block;
	}
</style>
