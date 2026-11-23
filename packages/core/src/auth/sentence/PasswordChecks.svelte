<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
	import { passwordReqs } from '../password-policy';

	let { pw }: { pw: string } = $props();

	const reqs = $derived(passwordReqs(pw));
	const met = $derived(reqs.filter((r) => r.met).length);
</script>

<div class="sp-meter" aria-hidden="true"><i style:width="{pw ? (met / reqs.length) * 100 : 0}%"></i></div>
<ul class="sp-checks">
	{#each reqs as r (r.k)}
		<li class:met={r.met}>
			{#if r.met}<Icon icon={faCheck} size={13} />{:else}<span class="pend" aria-hidden="true"></span>{/if}{r.label}
		</li>
	{/each}
</ul>

<style>
	.pend {
		width: 5px;
		height: 5px;
		margin: 0 4px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.55;
	}
</style>
