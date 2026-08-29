import { browser } from '$app/environment';
import {
	listMyAddresses,
	updateMyAddress,
	setPrimaryAddress,
	removeAddress,
	type AccountAddress,
	type UpdateAddressInput
} from '$lib/api/addresses';
import { listMySharedAliases } from '$lib/api/aliases';
import { syncAddressUids } from '$lib/keys/uid-sync';

class AddressesStore {
	items = $state<AccountAddress[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;

	primary = $derived(this.items.find((a) => a.isPrimary) ?? this.items[0] ?? null);
	personal = $derived(this.items.filter((a) => !a.shared));
	shared = $derived(this.items.filter((a) => a.shared));

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	async load(): Promise<void> {
		if (!browser) return;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const [{ addresses }, shared] = await Promise.all([
				listMyAddresses(),
				listMySharedAliases().catch(() => ({ sharedAliases: [] }))
			]);
			if (this.#accountId !== acct) return;
			this.items = [
				...addresses,
				...shared.sharedAliases.map((a) => ({
					id: a.addressId,
					email: a.email,
					localPart: a.localPart,
					customDomainId: a.customDomainId ?? null,
					name: a.name,
					isPrimary: false,
					shared: true,
					sharedAliasId: a.id,
					createdAt: a.createdAt,
					updatedAt: a.updatedAt
				}))
			];
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load addresses';
			this.items = [];
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async update(id: string, input: UpdateAddressInput): Promise<AccountAddress> {
		const updated = await updateMyAddress(id, input);
		this.items = this.items.map((a) => (a.id === updated.id ? updated : a));
		return updated;
	}

	async setPrimary(id: string): Promise<void> {
		const updated = await setPrimaryAddress(id);
		this.items = this.items.map((a) =>
			a.id === updated.id ? updated : { ...a, isPrimary: false }
		);
	}

	async remove(id: string): Promise<void> {
		await removeAddress(id);
		this.items = this.items.filter((a) => a.id !== id);
		this.#syncUids();
	}

	#syncUids(): void {
		if (!this.#accountId) return;
		void syncAddressUids(
			this.#accountId,
			this.items.filter((a) => !a.shared).map((a) => a.email)
		);
	}

	getByEmail(email: string): AccountAddress | null {
		const norm = email.trim().toLowerCase();
		return this.items.find((a) => a.email.toLowerCase() === norm) ?? null;
	}

	getById(id: string): AccountAddress | null {
		return this.items.find((a) => a.id === id) ?? null;
	}

	clear(): void {
		this.items = [];
		this.error = null;
	}
}

export const addresses = new AddressesStore();
