<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { platform } from '$platform';
	import type { NotificationTarget } from '$lib/platform/types';

	let { children } = $props();

	function openFromNotification(target: NotificationTarget) {
		const record = accounts.byId(target.accountId);
		if (!record) return;
		if (auth.accountId !== record.accountId) auth.activate(record.accountId);
		void goto(`/u/${record.slot}/mail/inbox/${encodeURIComponent(target.messageId)}`);
	}

	onMount(() => {
		const notifications = platform.notifications;
		if (!notifications) return;
		const drain = async () => {
			const target = await notifications.takeOpened().catch(() => null);
			if (target) openFromNotification(target);
		};
		void drain();
		return notifications.onOpened(() => void drain());
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>
{@render children()}
