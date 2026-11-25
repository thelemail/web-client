<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import RecoverFlow from '$core/auth/RecoverFlow.svelte';
	import Status from '$core/auth/sentence/Status.svelte';
	import { delayed } from '$core/async/delayed.svelte';
	import { signInMovedToAuth } from '$core/custody/unlock';
	import { productTarget } from '$core/products';
	import { m } from '$paraglide/messages.js';

	let mode = $state<'checking' | 'here' | 'auth'>('checking');
	const checking = delayed(() => mode !== 'here', { minVisible: 0 });

	onMount(async () => {
		const target = productTarget('auth');
		if (target && (await signInMovedToAuth())) {
			mode = 'auth';
			window.location.assign(`${target.origin}/recover${page.url.search}`);
			return;
		}
		mode = 'here';
	});
</script>

{#if mode === 'here'}
	<RecoverFlow />
{:else}
	<div class="sp" aria-busy="true">
		<Status tone={checking.visible ? 'busy' : 'hint'}>{checking.visible ? m.common_loading() : ''}</Status>
	</div>
{/if}
