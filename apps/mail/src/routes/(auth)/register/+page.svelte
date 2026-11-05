<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { platform } from '$platform';
	import RegisterFlow from '$core/auth/RegisterFlow.svelte';
	import type { RegisterCheckout } from '$core/auth/register-checkout';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { createCheckoutSession } from '$core/api/billing';
	import { changeMyWorkspaceType } from '$core/api/workspaces';

	async function checkout(slot: number, order: RegisterCheckout) {
		try {
			if (order.workspaceType !== 'personal') {
				await changeMyWorkspaceType({ type: order.workspaceType });
			}
			const origin = platform.returnOrigin();
			const { url } = await createCheckoutSession({
				planCode: order.planCode,
				interval: order.interval,
				seats: order.seats,
				successUrl: `${origin}/u/${slot}/billing/return`,
				cancelUrl: `${origin}/u/${slot}/billing/choose?canceled=1`
			});
			platform.openExternal(url);
		} catch (err) {
			console.error('register: checkout session failed', err);
			await goto(`/u/${slot}/billing/choose`);
		}
	}
</script>

<RegisterFlow
	afterRegister={(slot) => goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot))}
	{checkout}
/>
