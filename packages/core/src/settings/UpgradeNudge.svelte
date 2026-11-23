<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faArrowRight, faSparkles } from '@fortawesome/pro-regular-svg-icons';
	import { page } from '$app/state';

	let { title, desc }: { title: string; desc: string } = $props();

	const href = $derived(`/u/${page.params.slot ?? '0'}/billing/choose`);
</script>

<a class="upgrade-nudge" {href}>
	<span class="up-ic"><Icon icon={faSparkles} size={18} /></span>
	<span class="up-body">
		<span class="up-t">{title}</span>
		<span class="up-d">{desc}</span>
	</span>
	<Icon icon={faArrowRight} size={16} />
</a>

<style>
	.up-body,
	.up-t,
	.up-d {
		display: block;
	}
</style>
