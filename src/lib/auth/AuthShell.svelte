<script lang="ts">
	import '$lib/auth/auth.css';
	import type { Snippet } from 'svelte';
	import wordmark from '$lib/assets/logo-wordmark.svg';
	import wordmarkInverse from '$lib/assets/logo-wordmark-inverse.svg';
	import SignedInStrip from './SignedInStrip.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="auth">
	<div class="stagebody">
		<a class="pagebrand" href="/" aria-label="Thelemail">
			<img class="wm-light" src={wordmark} alt="Thelemail" />
			<img class="wm-dark" src={wordmarkInverse} alt="" aria-hidden="true" />
		</a>
		<SignedInStrip />
		{@render children()}
	</div>
</div>
