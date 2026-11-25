import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { accounts } from './accounts.svelte';

export function followAccountSlot(accountId: () => string, slot: () => number): void {
	$effect(() => {
		const now = accounts.byId(accountId())?.slot;
		if (now === undefined || now === slot()) return;
		const target = untrack(() => window.location.pathname.replace(/^\/u\/\d+(?=\/|$)/, `/u/${now}`) + window.location.search + window.location.hash);
		void goto(target, { replace: true });
	});
}
