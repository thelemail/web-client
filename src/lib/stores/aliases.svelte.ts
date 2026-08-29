import { browser } from '$app/environment';
import {
	listSharedAliases,
	createSharedAlias,
	updateSharedAlias,
	rotateSharedAliasMembers,
	deleteSharedAlias,
	type SharedAlias,
	type CreateSharedAliasInput,
	type RotateSharedAliasInput
} from '$lib/api/aliases';

class AliasesStore {
	items = $state<SharedAlias[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#workspaceId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	getById(id: string): SharedAlias | null {
		return this.items.find((a) => a.id === id) ?? null;
	}

	getByAddressId(addressId: string): SharedAlias | null {
		return this.items.find((a) => a.addressId === addressId) ?? null;
	}

	async load(workspaceId: string): Promise<void> {
		if (!browser) return;
		this.#workspaceId = workspaceId;
		this.loading = true;
		this.error = null;
		try {
			const { sharedAliases } = await listSharedAliases(workspaceId);
			if (this.#workspaceId !== workspaceId) return;
			this.items = sharedAliases;
		} catch (err) {
			if (this.#workspaceId !== workspaceId) return;
			this.error = err instanceof Error ? err.message : 'failed to load shared addresses';
			this.items = [];
		} finally {
			if (this.#workspaceId === workspaceId) this.loading = false;
		}
	}

	async create(workspaceId: string, input: CreateSharedAliasInput): Promise<SharedAlias> {
		const created = await createSharedAlias(workspaceId, input);
		this.items = [...this.items, created];
		return created;
	}

	async rename(workspaceId: string, aliasId: string, name: string): Promise<SharedAlias> {
		const updated = await updateSharedAlias(workspaceId, aliasId, name);
		this.items = this.items.map((a) => (a.id === updated.id ? updated : a));
		return updated;
	}

	async rotate(
		workspaceId: string,
		aliasId: string,
		input: RotateSharedAliasInput
	): Promise<SharedAlias> {
		const updated = await rotateSharedAliasMembers(workspaceId, aliasId, input);
		this.items = this.items.map((a) => (a.id === updated.id ? updated : a));
		return updated;
	}

	async remove(workspaceId: string, aliasId: string): Promise<void> {
		await deleteSharedAlias(workspaceId, aliasId);
		this.items = this.items.filter((a) => a.id !== aliasId);
	}

	clear(): void {
		this.items = [];
		this.error = null;
		this.loading = false;
		this.#workspaceId = null;
	}
}

export const aliases = new AliasesStore();
