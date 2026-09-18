import { browser } from '$app/environment';
import {
	createReadDelegation,
	listReadDelegations,
	pauseReadDelegation,
	resendReadDelegationConfirmation,
	resumeReadDelegation,
	revokeReadDelegation,
	rotateReadDelegation,
	type CreateReadDelegationRequest,
	type ReadDelegation,
	type RotateReadDelegationRequest
} from '$core/api/readDelegations';

class ReadDelegationsStore {
	items = $state<Map<string, ReadDelegation[]>>(new Map());
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#inflight = new Set<string>();

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.#inflight.clear();
		this.clear();
	}

	for(addressId: string): ReadDelegation[] {
		return this.items.get(addressId) ?? [];
	}

	async load(addressId: string): Promise<void> {
		if (!browser) return;
		if (this.#inflight.has(addressId)) return;
		this.#inflight.add(addressId);
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const { readDelegations } = await listReadDelegations(addressId);
			if (this.#accountId !== acct) return;
			this.put(addressId, readDelegations);
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'Could not load forwarding.';
		} finally {
			this.#inflight.delete(addressId);
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async create(addressId: string, body: CreateReadDelegationRequest): Promise<ReadDelegation> {
		const created = await createReadDelegation(addressId, body);
		this.put(addressId, [created, ...this.for(addressId)]);
		return created;
	}

	async rotate(addressId: string, id: string, body: RotateReadDelegationRequest): Promise<ReadDelegation> {
		const next = await rotateReadDelegation(addressId, id, body);
		await this.load(addressId);
		return next;
	}

	async pause(addressId: string, id: string): Promise<void> {
		this.replace(addressId, await pauseReadDelegation(addressId, id));
	}

	async resume(addressId: string, id: string): Promise<void> {
		this.replace(addressId, await resumeReadDelegation(addressId, id));
	}

	async revoke(addressId: string, id: string): Promise<ReadDelegation> {
		const revoked = await revokeReadDelegation(addressId, id);
		this.replace(addressId, revoked);
		return revoked;
	}

	resend(addressId: string, id: string): Promise<void> {
		return resendReadDelegationConfirmation(addressId, id);
	}

	private replace(addressId: string, next: ReadDelegation): void {
		this.put(
			addressId,
			this.for(addressId).map((d) => (d.id === next.id ? next : d))
		);
	}

	private put(addressId: string, list: ReadDelegation[]): void {
		const next = new Map(this.items);
		next.set(addressId, list);
		this.items = next;
	}

	clear(): void {
		this.items = new Map();
		this.error = null;
	}
}

export const readDelegations = new ReadDelegationsStore();
