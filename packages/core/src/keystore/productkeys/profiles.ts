import type { ProfileId } from '../../interop/generated/profiles';
import { LEGACY_IMPORT_PREFIX } from '../../interop/generated/profiles';
import { isLegacyImportFormat } from '../registry';

export const PROFILE = {
	secretWrapV2: 'secret-wrap-v2',
	productBundleV1: 'product-bundle-v1',
	accountAuthority: 'account-authority-ed25519-v1',
	calendarIdentity: 'calendar-identity-v1',
	mailImportDedup: 'mail-import-dedup-v1',
	mailSearchIndex: 'mail-search-index-v1',
	mailSearchRoot: 'mail-search-root-v1',
	mailClassic: 'mail-classic-v1',
	legacyImportPrefix: LEGACY_IMPORT_PREFIX
} as const satisfies Record<string, ProfileId | typeof LEGACY_IMPORT_PREFIX>;

export function isMailKeyProfile(p: string): boolean {
	return p === PROFILE.mailClassic || isLegacyImportFormat(p);
}
