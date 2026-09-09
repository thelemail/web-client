import { describe, it, expect } from 'vitest';
import { mergeReferences, replyThreadHeaders } from './threading';

describe('mergeReferences', () => {
	it('appends the parent id to existing references', () => {
		expect(mergeReferences(['<a@x>', '<b@x>'], '<c@x>')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
	});

	it('does not duplicate a parent already present', () => {
		expect(mergeReferences(['<a@x>', '<b@x>'], '<b@x>')).toEqual(['<a@x>', '<b@x>']);
	});

	it('dedupes existing references and drops empty entries', () => {
		expect(mergeReferences(['<a@x>', '', '<a@x>'], undefined)).toEqual(['<a@x>']);
	});

	it('handles missing inputs', () => {
		expect(mergeReferences(undefined, undefined)).toEqual([]);
		expect(mergeReferences(undefined, '<a@x>')).toEqual(['<a@x>']);
	});
});

describe('replyThreadHeaders', () => {
	it('builds the full header set from thread ids', () => {
		const h = replyThreadHeaders({
			seedId: 'msg-1',
			externalMessageId: '<parent@x>',
			references: ['<root@x>']
		});
		expect(h.inReplyToMessageId).toBe('msg-1');
		expect(h.inReplyToHeader).toBe('<parent@x>');
		expect(h.references).toEqual(['<root@x>', '<parent@x>']);
	});

	it('omits references when nothing is known', () => {
		const h = replyThreadHeaders({ seedId: 'msg-1' });
		expect(h.inReplyToMessageId).toBe('msg-1');
		expect(h.inReplyToHeader).toBeUndefined();
		expect(h.references).toBeUndefined();
	});

	it('threads by internal id even without an external message id', () => {
		const h = replyThreadHeaders({ seedId: 'msg-2', references: ['<root@x>'] });
		expect(h.inReplyToMessageId).toBe('msg-2');
		expect(h.references).toEqual(['<root@x>']);
	});
});
