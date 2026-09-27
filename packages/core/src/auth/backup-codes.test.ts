import { describe, expect, it } from 'vitest';
import { BACKUP_CODE_MAX_LENGTH, BACKUP_CODE_PLACEHOLDER, backupCodesFile } from './backup-codes';

const codes = Array.from({ length: 10 }, (_, i) => `7K2M-9QXA-4TNB-HD3R-WP6E-1CVJ-8FS${i}`);

describe('backupCodesFile', () => {
	it('lists every code on its own numbered line', async () => {
		const text = await backupCodesFile(codes, 'ada@thelemail.com', new Date('2026-09-27T10:00:00Z')).text();
		expect(text).toContain('Account:   ada@thelemail.com');
		expect(text).toContain('Generated: 2026-09-27');
		expect(text).toContain('   1. 7K2M-9QXA-4TNB-HD3R-WP6E-1CVJ-8FS0\n');
		expect(text).toContain('  10. 7K2M-9QXA-4TNB-HD3R-WP6E-1CVJ-8FS9\n');
	});
});

describe('backup code input limits', () => {
	it('leave room for a full code typed with spaces', () => {
		expect(BACKUP_CODE_PLACEHOLDER).toHaveLength(34);
		expect(BACKUP_CODE_MAX_LENGTH).toBeGreaterThanOrEqual(34 + 7);
	});
});
