<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import RegisterFlow from '$core/auth/RegisterFlow.svelte';
	import { startCheckout } from '$core/auth/register-checkout';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { signInMovedToAuth } from '$core/custody/unlock';
	import { startFor } from '$core/producthandoff/fallback';
	import HandoffCard from '$core/auth/form/HandoffCard.svelte';
	import { productHost } from '$core/products';
	import { m } from '$paraglide/messages.js';

	let mode = $state<'checking' | 'here' | 'auth'>('checking');

	onMount(async () => {
		if (await signInMovedToAuth()) {
			mode = 'auth';
			await startFor(null, '/', 'register', page.url.search).catch(() => {
				mode = 'here';
			});
			return;
		}
		mode = 'here';
	});
</script>

{#if mode === 'here'}
	<RegisterFlow afterRegister={(slot) => goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot))} checkout={startCheckout} />
{:else if mode === 'auth'}
	<HandoffCard
		title={m.handoff_to_auth_register_title()}
		lede={m.handoff_to_auth_register_lede({ host: productHost('auth') })}
		to={productHost('auth')}
		retry={() => location.reload()}
	/>
{/if}
