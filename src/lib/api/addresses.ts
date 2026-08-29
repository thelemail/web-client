import { apiFetch } from './client';

export interface AccountAddress {
	id: string;
	email: string;
	localPart: string;
	customDomainId?: string | null;
	name?: string | null;
	isPrimary: boolean;
	shared?: boolean;
	sharedAliasId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpdateAddressInput {
	name?: string | null;
}

export function listMyAddresses(): Promise<{ addresses: AccountAddress[] }> {
	return apiFetch('/v1/me/addresses');
}

export function updateMyAddress(id: string, input: UpdateAddressInput): Promise<AccountAddress> {
	return apiFetch(`/v1/me/addresses/${id}`, { method: 'PATCH', body: input });
}

export function setPrimaryAddress(id: string): Promise<AccountAddress> {
	return apiFetch(`/v1/me/addresses/${id}/primary`, { method: 'POST' });
}

export function removeAddress(id: string): Promise<void> {
	return apiFetch(`/v1/me/addresses/${id}`, { method: 'DELETE' });
}
