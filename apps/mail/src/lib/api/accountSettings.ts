import { apiFetch } from './client';
import type {
	AccountSettingsResponse,
	AccountSettingsSectionResponse
} from './types';

export function getAccountSettings(): Promise<AccountSettingsResponse> {
	return apiFetch<AccountSettingsResponse>('/v1/account/settings');
}

export function putAccountSettingsSection(
	section: string,
	value: Record<string, unknown>
): Promise<AccountSettingsSectionResponse> {
	return apiFetch<AccountSettingsSectionResponse>(
		`/v1/account/settings/${encodeURIComponent(section)}`,
		{ method: 'PUT', body: value }
	);
}
