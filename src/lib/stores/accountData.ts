import { auth } from './auth.svelte';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { customDomains } from './customDomains.svelte';
import { addresses } from './addresses.svelte';
import { signatures } from './signatures.svelte';
import { aliases } from './aliases.svelte';
import { aliasKeys } from './aliasKeys.svelte';

let loadedFor: string | null = null;

export function ensureAccountData(accountId: string): void {
	if (loadedFor === accountId) return;
	loadedFor = accountId;
	void (async () => {
		void accountSettings.hydrate();
		void auth.loadProfile(accountId);
		void aliasKeys.load(accountId);
		await workspaces.load(accountId);
		if (loadedFor !== accountId) return;
		const workspaceId = workspaces.workspace?.id ?? null;
		void customDomains.load(workspaceId);
		await addresses.load();
		void signatures.load();
		if (workspaceId && workspaces.canManage(accountId)) {
			void aliases.load(workspaceId);
		}
	})();
}
