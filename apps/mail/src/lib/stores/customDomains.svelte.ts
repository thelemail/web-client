import { browser } from '$app/environment';
import {
	listWorkspaceDomains,
	createWorkspaceDomain,
	getWorkspaceDomain,
	verifyWorkspaceDomain,
	deleteWorkspaceDomain,
	type CustomDomain,
	type CustomDomainWithRecords,
	type RequiredDNSRecord
} from '$lib/api/customDomains';

class CustomDomainsStore {
	items = $state<CustomDomain[]>([]);
	records = $state<Map<string, RequiredDNSRecord[]>>(new Map());
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	async load(workspaceId: string | null): Promise<void> {
		if (!browser || !workspaceId) return;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const { domains } = await listWorkspaceDomains(workspaceId);
			if (this.#accountId !== acct) return;
			this.items = domains;
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load domains';
			this.items = [];
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async create(workspaceId: string, domain: string): Promise<CustomDomainWithRecords> {
		const result = await createWorkspaceDomain(workspaceId, domain);
		this.upsert(result);
		return result;
	}

	async fetchDetail(workspaceId: string, domainId: string): Promise<CustomDomainWithRecords> {
		const result = await getWorkspaceDomain(workspaceId, domainId);
		this.upsert(result);
		return result;
	}

	async verify(workspaceId: string, domainId: string): Promise<CustomDomainWithRecords> {
		const result = await verifyWorkspaceDomain(workspaceId, domainId);
		this.upsert(result);
		return result;
	}

	async remove(workspaceId: string, domainId: string): Promise<void> {
		await deleteWorkspaceDomain(workspaceId, domainId);
		this.items = this.items.filter((d) => d.id !== domainId);
		const next = new Map(this.records);
		next.delete(domainId);
		this.records = next;
	}

	private upsert(result: CustomDomainWithRecords): void {
		const idx = this.items.findIndex((d) => d.id === result.domain.id);
		if (idx === -1) {
			this.items = [...this.items, result.domain];
		} else {
			this.items = this.items.map((d, i) => (i === idx ? result.domain : d));
		}
		const next = new Map(this.records);
		next.set(result.domain.id, result.records);
		this.records = next;
	}

	clear(): void {
		this.items = [];
		this.records = new Map();
		this.error = null;
	}
}

export const customDomains = new CustomDomainsStore();
