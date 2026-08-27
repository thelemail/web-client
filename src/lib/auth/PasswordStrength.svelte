<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import { STRENGTH_LABELS, passwordReqs, scorePassword } from './password-policy';

	interface Props {
		pw: string;
	}

	let { pw }: Props = $props();

	const score = $derived(pw ? scorePassword(pw) : 0);
	const reqs = $derived(passwordReqs(pw));
</script>

{#if pw}
	<div class="strength">
		<div class="strbar s{score}"><i></i><i></i><i></i><i></i></div>
		<div class="strlab s{score}">Strength: <b>{STRENGTH_LABELS[score]}</b></div>
	</div>
{/if}
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
