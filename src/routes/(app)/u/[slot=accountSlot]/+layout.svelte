<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import { realtime } from '$lib/realtime/realtime.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { keystore } from '$lib/keystore/keystore-client';
	import { auth } from '$lib/stores/auth.svelte';
	import { platform } from '$platform';
	import MirrorScopePrompt from '$lib/mail/MirrorScopePrompt.svelte';
	import { mailbox } from '$lib/stores/mailbox.svelte';

	let { children, data } = $props();

	$effect(() => {
		lifecycle.setAccount(data.accountId);
	});

	onMount(() => realtime.start());

	onMount(() => {
		const mirror = platform.mirror;
		if (!mirror) return;

		void (async () => {
			try {
				await mirror.open(data.accountId);
				const token = auth.getAccessToken(data.accountId);
				if (token) await mirror.startSync(data.accountId, token);
			} catch (err) {
				console.warn('mirror: could not start', err);
			}
		})();

		const pushToken = async () => {
			await auth.ensureFreshToken(data.accountId);
			const token = auth.getAccessToken(data.accountId);
			if (token) await mirror.setToken(data.accountId, token).catch(() => {});
		};
		const pushTimer = setInterval(() => void pushToken(), 60_000);

		const unsubscribe = mirror.onChanged?.((accountId) => {
			if (accountId !== data.accountId) return;
			void mailbox.refreshLoaded();
		});

		const unsubscribeExpired = mirror.onTokenExpired?.((accountId) => {
			if (accountId !== data.accountId) return;
			void (async () => {
				if (await auth.tryRefresh(accountId)) await pushToken();
			})();
		});

		return () => {
			clearInterval(pushTimer);
			unsubscribe?.();
			unsubscribeExpired?.();
			void mirror.stopWatch(data.accountId).catch(() => {});
		};
	});

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

<MirrorScopePrompt accountId={data.accountId} />
