import { auth } from './auth.svelte';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { customDomains } from './customDomains.svelte';
import { addresses } from './addresses.svelte';
import { signatures } from './signatures.svelte';

let loadedFor: string | null = null;

export function ensureAccountData(accountId: string): void {
	if (loadedFor === accountId) return;
	loadedFor = accountId;
	void (async () => {
		void accountSettings.hydrate();
		void auth.loadProfile(accountId);
		await workspaces.load(accountId);
		if (loadedFor !== accountId) return;
		void customDomains.load(workspaces.workspace?.id ?? null);
		await addresses.load();
		void signatures.load();
	})();
}
