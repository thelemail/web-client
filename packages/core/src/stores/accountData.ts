import { auth } from './auth.svelte';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { customDomains } from './customDomains.svelte';
import { addresses } from './addresses.svelte';
import { signatures } from './signatures.svelte';
import { aliases } from './aliases.svelte';
import { aliasKeys } from './aliasKeys.svelte';
import { calendarKeys } from './calendarKeys.svelte';
import { billing } from './billing.svelte';
import { calendarStore } from '$core/calendar/store.svelte';
import { currentProduct } from '$core/products';

let loadedFor: string | null = null;

export function ensureAccountData(accountId: string): void {
	if (loadedFor === accountId && workspaces.workspace) return;
	loadedFor = accountId;
	void (async () => {
		void accountSettings.hydrate();
		void auth.loadProfile(accountId);
		void aliasKeys.load(accountId);
		void calendarKeys.load(accountId);
		await workspaces.load(accountId);
		if (loadedFor !== accountId) return;
		const workspaceId = workspaces.workspace?.id ?? null;
		await addresses.load();
		if (currentProduct !== 'app') return;
		void customDomains.load(workspaceId);
		void signatures.load();
		if (workspaceId && workspaces.canManage(accountId)) {
			void aliases.load(workspaceId);
		}
	})();
}

export async function reloadWorkspaceData(accountId: string): Promise<void> {
	loadedFor = null;
	aliases.clear();
	customDomains.clear();
	calendarStore.setAccount(null);
	await billing.refresh();
	ensureAccountData(accountId);
	calendarStore.setAccount(accountId);
}
