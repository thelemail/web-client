import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { accounts } from './accounts.svelte';

export function followAccountSlot(accountId: () => string, slot: () => number): void {
	$effect(() => {
		const now = accounts.byId(accountId())?.slot;
		if (now === undefined || now === slot()) return;
		const target = untrack(() => page.url.pathname.replace(/^\/u\/\d+(?=\/|$)/, `/u/${now}`) + page.url.search + page.url.hash);
		void goto(target, { replace: true });
	});
}
