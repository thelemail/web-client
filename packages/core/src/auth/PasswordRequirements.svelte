<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import { strengthLabel, passwordReqs, scorePassword } from './password-policy';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		pw: string;
	}

	let { pw }: Props = $props();

	const score = $derived(pw ? scorePassword(pw) : 0);
	const reqs = $derived(passwordReqs(pw));
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

{#if pw}
	<div class="strength">
		<div class="strbar s{score}"><i></i><i></i><i></i><i></i></div>
		<div class="strlab s{score}">
			<Rich text={m.auth_password_strength({ label: strengthLabel(score) })} tags={{ b: bold }} />
		</div>
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
