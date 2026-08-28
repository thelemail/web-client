<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import { realtime } from '$lib/realtime/realtime.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { keystore } from '$lib/keystore/keystore-client';

	let { children, data } = $props();

	$effect(() => {
		lifecycle.setAccount(data.accountId);
	});

	onMount(() => realtime.start());

	onMount(() => {
		const unsubscribe = keystore.subscribe((msg) => {
			if (msg.type === 'clearedAll') {
				void goto('/login');
			} else if (msg.type === 'cleared' && msg.accountId === data.accountId) {
				const remaining = accounts.list.find((r) => r.accountId !== msg.accountId);
				void goto(remaining ? `/u/${remaining.slot}/mail/inbox` : '/login');
			}
		});
		return unsubscribe;
	});
</script>

{@render children()}
