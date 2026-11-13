import { describe, expect, it } from 'vitest';
import { trackOpenRow, withOpenRow } from './stickyRow';
import type { Message } from './data';

function row(id: string, unread = true): Message {
	return {
		id,
		folder: 'inbox',
		direction: 'received',
		from: id,
		fromAddr: `${id}@example.test`,
		to: '',
		init: id[0],
		bg: '#fff',
		fg: '#000',
		subj: id,
		labels: [],
		unread,
		starred: false,
		prev: '',
		body: [],
		epoch: 0
	};
}

describe('open row in a filtered list', () => {
	it('keeps the open row in place after it stops matching the view', () => {
		const before = [row('a'), row('b'), row('c')];
		const sticky = trackOpenRow(before, 'b', null);
		const after = [row('a'), row('c')];
		const shown = withOpenRow(after, trackOpenRow(after, 'b', sticky), 'b', () => row('b', false));
		expect(shown.map((m) => m.id)).toEqual(['a', 'b', 'c']);
		expect(shown[1].unread).toBe(false);
	});

	it('lets the row go once another message is open', () => {
		const sticky = trackOpenRow([row('a'), row('b'), row('c')], 'b', null);
		const after = [row('a'), row('c')];
		const next = trackOpenRow(after, 'c', sticky);
		expect(withOpenRow(after, next, 'c', () => null).map((m) => m.id)).toEqual(['a', 'c']);
	});

	it('does not add a row when nothing is open', () => {
		const rows = [row('a')];
		expect(withOpenRow(rows, trackOpenRow(rows, null, null), null, () => null)).toBe(rows);
	});
});
