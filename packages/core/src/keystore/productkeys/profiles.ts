export const PROFILE = {
	secretWrapV2: 'secret-wrap-v2',
	productBundleV1: 'product-bundle-v1',
	accountAuthority: 'account-authority-ed25519-v1',
	calendarIdentity: 'calendar-identity-v1',
	mailImportDedup: 'mail-import-dedup-v1',
	mailSearchIndex: 'mail-search-index-v1',
	mailSearchRoot: 'mail-search-root-v1',
	mailClassic: 'mail-classic-v1',
	legacyImportPrefix: 'legacy-import-'
} as const;

export function isMailKeyProfile(p: string): boolean {
	return p === PROFILE.mailClassic || (p.startsWith(PROFILE.legacyImportPrefix) && p.length > PROFILE.legacyImportPrefix.length);
}
