<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
	import { passwordReqs, passwordStrength } from '../password-policy';
	import { m } from '$paraglide/messages.js';

	let { pw }: { pw: string } = $props();

	const reqs = $derived(passwordReqs(pw));
	const score = $derived(passwordStrength(pw));
	const tone = $derived(score === 1 ? 's1' : score === 2 ? 's2' : 's3');
	const label = $derived(
		score === 0
			? ''
			: score === 1
				? reqs[0].met
					? m.auth_password_strength_weak()
					: m.auth_password_strength_short()
				: score === 2
					? m.auth_password_strength_short()
					: score === 3
						? m.auth_password_strength_good()
						: m.auth_password_strength_strong()
	);
</script>

<div class="af-meter">
	{#each [1, 2, 3, 4] as i (i)}<i class={i <= score ? tone : ''}></i>{/each}
	<span class="af-meter-label">{label}</span>
</div>
<ul class="af-checks">
	{#each reqs as r (r.k)}
		<li class:met={r.met}>
			<span class="ic">{#if r.met}<Icon icon={faCheck} size={12} />{:else}<span class="pend" aria-hidden="true"></span>{/if}</span>{r.label}
		</li>
	{/each}
</ul>
