import { browser } from '$app/environment';
import { listWorkspaceAliases } from '$core/api/aliases';
import type { AccountAddress } from '$core/api/addresses';

class WorkspaceAddressesStore {
	items = $state<AccountAddress[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#workspaceId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	async load(workspaceId: string): Promise<void> {
		if (!browser) return;
		this.#workspaceId = workspaceId;
		this.loading = true;
		this.error = null;
		try {
			const { addresses } = await listWorkspaceAliases(workspaceId);
			if (this.#workspaceId !== workspaceId) return;
			this.items = addresses;
		} catch (err) {
			if (this.#workspaceId !== workspaceId) return;
			this.error = err instanceof Error ? err.message : 'failed to load workspace addresses';
			this.items = [];
		} finally {
			if (this.#workspaceId === workspaceId) this.loading = false;
		}
	}

	async reload(): Promise<void> {
		const workspaceId = this.#workspaceId;
		if (workspaceId) await this.load(workspaceId);
	}

	clear(): void {
		this.items = [];
		this.error = null;
		this.loading = false;
		this.#workspaceId = null;
	}
}

export const workspaceAddresses = new WorkspaceAddressesStore();
