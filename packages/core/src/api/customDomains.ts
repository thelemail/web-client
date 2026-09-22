import { apiFetch } from './client';

export type CustomDomainStatus = 'pending' | 'owned' | 'ready' | 'active' | 'failed';
export type DNSRecordKind = 'ownership' | 'mx' | 'dkim' | 'spf' | 'dmarc' | 'wkd';
export type DNSRecordPhase = 'ownership' | 'sending' | 'routing';
export type DNSRecordStatus = 'ok' | 'missing' | 'mismatch';
export type RequiredDNSRecordType = 'TXT' | 'MX' | 'CNAME';
export type CustomDomainCheckState = 'running' | 'expired';
export type CustomDomainCheckResult =
	| 'ownership_missing'
	| 'ownership_mismatch'
	| 'ownership_wildcard'
	| 'claimed_elsewhere'
	| 'dkim_missing'
	| 'dkim_mismatch'
	| 'spf_missing'
	| 'spf_mismatch'
	| 'dmarc_missing'
	| 'mx_missing'
	| 'mx_mismatch'
	| 'dns_unavailable';

export interface CustomDomainCheck {
	stage: DNSRecordPhase;
	state: CustomDomainCheckState;
	startedAt: string;
	deadlineAt: string;
	attempts: number;
	lastCheckedAt?: string | null;
	nextCheckAt?: string | null;
	result?: CustomDomainCheckResult | null;
}

export interface CustomDomain {
	id: string;
	workspaceId: string;
	domain: string;
	status: CustomDomainStatus;
	addressCount: number;
	dormantAt?: string | null;
	ownershipVerifiedAt?: string | null;
	mxVerifiedAt?: string | null;
	dkimVerifiedAt?: string | null;
	spfVerifiedAt?: string | null;
	dmarcVerifiedAt?: string | null;
	wkdVerifiedAt?: string | null;
	lastCheckedAt?: string | null;
	lastError?: CustomDomainCheckResult | null;
	check?: CustomDomainCheck | null;
	actionableStage?: DNSRecordPhase | null;
	ownershipMissingSince?: string | null;
	releaseAt?: string | null;
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
	verifiedAt?: string | null;
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
