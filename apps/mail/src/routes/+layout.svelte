<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import favicon from '$core/assets/favicon.svg';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { platform } from '$platform';
	import type { NotificationTarget } from '$core/platform/types';
	import { accountTransition } from '$core/stores/accountTransition.svelte';
	import AccountTransition from '$core/components/AccountTransition.svelte';

	let { children } = $props();

	function openFromNotification(target: NotificationTarget) {
		const record = accounts.byId(target.accountId);
		if (!record) return;
		const path = `/u/${record.slot}/mail/inbox/${encodeURIComponent(target.messageId)}`;
		if (auth.accountId === record.accountId) {
			void goto(path);
			return;
		}
		void accountTransition.run('switch', record.email ?? null, async () => {
			auth.activate(record.accountId);
			await goto(path);
		});
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
<div data-app-ready style="display: contents">{@render children()}</div>
<AccountTransition />
