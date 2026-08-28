import { apiFetch } from './client';

export type CustomDomainStatus = 'pending' | 'owned' | 'ready' | 'active' | 'failed';
export type DNSRecordKind = 'ownership' | 'mx' | 'dkim' | 'spf' | 'dmarc' | 'wkd';
export type DNSRecordPhase = 'ownership' | 'sending' | 'routing';
export type DNSRecordStatus = 'ok' | 'missing' | 'mismatch';
export type RequiredDNSRecordType = 'TXT' | 'MX' | 'CNAME';

export interface CustomDomain {
	id: string;
	workspaceId: string;
	domain: string;
	status: CustomDomainStatus;
	addressCount: number;
	ownershipVerifiedAt?: string | null;
	mxVerifiedAt?: string | null;
	dkimVerifiedAt?: string | null;
	spfVerifiedAt?: string | null;
	dmarcVerifiedAt?: string | null;
	wkdVerifiedAt?: string | null;
	lastCheckedAt?: string | null;
	lastError?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface RequiredDNSRecord {
	kind: DNSRecordKind;
	phase: DNSRecordPhase;
	type: RequiredDNSRecordType;
	host: string;
	value: string;
	required: boolean;
	status: DNSRecordStatus;
	lastCheckedAt?: string | null;
}

export interface CustomDomainWithRecords {
	domain: CustomDomain;
	records: RequiredDNSRecord[];
}

export function listWorkspaceDomains(workspaceId: string): Promise<{ domains: CustomDomain[] }> {
	return apiFetch(`/v1/workspaces/${workspaceId}/domains`);
}

export function createWorkspaceDomain(
	workspaceId: string,
	domain: string
): Promise<CustomDomainWithRecords> {
	return apiFetch(`/v1/workspaces/${workspaceId}/domains`, {
		method: 'POST',
		body: { domain }
	});
}

export function getWorkspaceDomain(
	workspaceId: string,
	domainId: string
): Promise<CustomDomainWithRecords> {
	return apiFetch(`/v1/workspaces/${workspaceId}/domains/${domainId}`);
}

export function verifyWorkspaceDomain(
	workspaceId: string,
	domainId: string
): Promise<CustomDomainWithRecords> {
	return apiFetch(`/v1/workspaces/${workspaceId}/domains/${domainId}/verify`, {
		method: 'POST'
	});
}

export function deleteWorkspaceDomain(workspaceId: string, domainId: string): Promise<void> {
	return apiFetch(`/v1/workspaces/${workspaceId}/domains/${domainId}`, { method: 'DELETE' });
}
