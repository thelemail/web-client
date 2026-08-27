import { describe, it, expect } from 'vitest';
import { initialChips } from './attachments';
import type { AttachmentDetail } from '$lib/api/types';

function att(overrides: Partial<AttachmentDetail> & Pick<AttachmentDetail, 'id' | 'ordinal'>): AttachmentDetail {
	return {
		pointer: { url: `https://blob/${overrides.id}`, expiresAt: '', sizeBytes: 0 },
		isInline: false,
		...overrides
	};
}

describe('initialChips', () => {
	it('drops inline parts and keeps real attachments', () => {
		const chips = initialChips([
			att({ id: 'a', ordinal: 0, isInline: true }),
			att({ id: 'b', ordinal: 1, isInline: false }),
			att({ id: 'c', ordinal: 2, isInline: true })
		]);
		expect(chips.map((c) => c.id)).toEqual(['b']);
		expect(chips[0].ordinal).toBe(1);
		expect(chips[0].state).toBe('loading');
	});

	it('preserves order and pointer for non-inline parts', () => {
		const chips = initialChips([
			att({ id: 'x', ordinal: 3 }),
			att({ id: 'y', ordinal: 5 })
		]);
		expect(chips.map((c) => c.id)).toEqual(['x', 'y']);
		expect(chips.map((c) => c.ordinal)).toEqual([3, 5]);
		expect(chips[0].pointer.url).toBe('https://blob/x');
	});

	it('returns nothing when every part is inline', () => {
		const chips = initialChips([
			att({ id: 'a', ordinal: 0, isInline: true }),
			att({ id: 'b', ordinal: 1, isInline: true })
		]);
		expect(chips).toEqual([]);
	});
});
