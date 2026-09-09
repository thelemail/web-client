import { browser } from '$app/environment';
import {
	listSigningDelegations,
	createSigningDelegation,
	revokeSigningDelegation,
	type CreateSigningDelegationRequest,
	type SigningDelegation
} from '$lib/api/delegations';

class DelegationsStore {
	items = $state<Map<string, SigningDelegation[]>>(new Map());
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	for(addressId: string): SigningDelegation[] {
		return this.items.get(addressId) ?? [];
	}

	async load(addressId: string): Promise<void> {
		if (!browser) return;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const { delegations } = await listSigningDelegations(addressId);
			if (this.#accountId !== acct) return;
			this.put(addressId, delegations);
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load delegations';
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async create(
		addressId: string,
		body: CreateSigningDelegationRequest
	): Promise<SigningDelegation> {
		const created = await createSigningDelegation(addressId, body);
		this.put(addressId, [created, ...this.for(addressId)]);
		return created;
	}

	async revoke(addressId: string, delegationId: string): Promise<SigningDelegation> {
		const revoked = await revokeSigningDelegation(addressId, delegationId);
		this.put(
			addressId,
			this.for(addressId).map((d) => (d.id === revoked.id ? revoked : d))
		);
		return revoked;
	}

	private put(addressId: string, list: SigningDelegation[]): void {
		const next = new Map(this.items);
		next.set(addressId, list);
		this.items = next;
	}

	clear(): void {
		this.items = new Map();
		this.error = null;
	}
}

export const delegations = new DelegationsStore();
