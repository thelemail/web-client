<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faMinus } from '@fortawesome/pro-regular-svg-icons';
	import { passwordReqs } from './password-policy';

	interface Props {
		pw: string;
	}

	let { pw }: Props = $props();

	const reqs = $derived(passwordReqs(pw));
</script>

<div class="reqs">
	{#each reqs as r (r.k)}
		<div class="req" class:met={r.met}>
			<span class="rk">
				{#if r.met}
					<Icon icon={faCheck} size={11} />
				{:else}
					<Icon icon={faMinus} size={11} />
				{/if}
			</span>
			{r.label}
		</div>
	{/each}
</div>
