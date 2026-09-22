import { browser } from '$app/environment';
import {
	listWorkspaceDomains,
	createWorkspaceDomain,
	getWorkspaceDomain,
	startWorkspaceDomainCheck,
	deleteWorkspaceDomain,
	type CustomDomain,
	type CustomDomainWithRecords,
	type DNSRecordPhase,
	type RequiredDNSRecord
} from '$core/api/customDomains';
import { ApiCallError } from '$core/api/types';

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

	async refresh(workspaceId: string): Promise<void> {
		const acct = this.#accountId;
		const { domains } = await listWorkspaceDomains(workspaceId);
		if (this.#accountId === acct) this.items = domains;
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

	async startCheck(
		workspaceId: string,
		domainId: string,
		stage: DNSRecordPhase
	): Promise<CustomDomainWithRecords> {
		try {
			const result = await startWorkspaceDomainCheck(workspaceId, domainId, stage);
			this.upsert(result);
			return result;
		} catch (err) {
			if (err instanceof ApiCallError && (err.status === 409 || err.status === 429)) {
				await this.fetchDetail(workspaceId, domainId).catch(() => undefined);
			}
			throw err;
		}
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
