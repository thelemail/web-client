<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
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
					<Check size={11} strokeWidth={2.5} />
				{:else}
					<Minus size={11} strokeWidth={2.5} />
				{/if}
			</span>
			{r.label}
		</div>
	{/each}
</div>
