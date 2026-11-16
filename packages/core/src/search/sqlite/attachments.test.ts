import { describe, expect, it } from 'vitest';
import { Coverage } from './types';
import { attachmentCoverage } from './writer';

describe('attachmentCoverage', () => {
	it('is absent without attachments and complete only when every file is', () => {
		expect(attachmentCoverage([])).toBeNull();
		expect(attachmentCoverage([Coverage.complete, Coverage.complete])).toBe(Coverage.complete);
	});

	it('stays pending while any file waits', () => {
		expect(attachmentCoverage([Coverage.complete, Coverage.processing])).toBe(Coverage.pending);
		expect(attachmentCoverage([Coverage.failed, Coverage.pending])).toBe(Coverage.pending);
	});

	it('reports the most actionable gap', () => {
		expect(attachmentCoverage([Coverage.unsupported, Coverage.partial])).toBe(Coverage.partial);
		expect(attachmentCoverage([Coverage.unsupported, Coverage.passwordRequired])).toBe(Coverage.passwordRequired);
		expect(attachmentCoverage([Coverage.timeout, Coverage.passwordRequired])).toBe(Coverage.timeout);
		expect(attachmentCoverage([Coverage.complete, Coverage.unsupported])).toBe(Coverage.unsupported);
	});
});
