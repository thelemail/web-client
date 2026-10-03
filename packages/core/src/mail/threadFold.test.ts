import { describe, expect, it } from 'vitest';
import { focusIdOf, foldRows, initialOpenIds } from './threadFold';
import type { ThreadEntry } from './data';

function entry(id: string, extra: Partial<ThreadEntry> = {}): ThreadEntry {
	return {
		id,
		from: id,
		fromAddr: `${id}@example.org`,
		to: 'me@example.org',
		init: id.slice(0, 2).toUpperCase(),
		bg: '#000',
		fg: '#fff',
		epoch: 0,
		body: [id],
		...extra
	};
}

function thread(n: number): ThreadEntry[] {
	return Array.from({ length: n }, (_, i) => entry(`m${i}`));
}

function shape(rows: ReturnType<typeof foldRows>): string[] {
	return rows.map((r) => (r.kind === 'entry' ? `${r.index}` : `fold:${r.start}+${r.count}`));
}

describe('focusIdOf', () => {
	it('keeps the opened message when it belongs to the thread', () => {
		expect(focusIdOf(thread(5), 'm2')).toBe('m2');
	});

	it('falls back to the newest message', () => {
		expect(focusIdOf(thread(5), 'other')).toBe('m4');
		expect(focusIdOf(thread(3), null)).toBe('m2');
		expect(focusIdOf([], 'm0')).toBeUndefined();
	});
});

describe('foldRows', () => {
	it('shows short threads in full', () => {
		expect(shape(foldRows(thread(4), new Set(['m3']), false))).toEqual(['0', '1', '2', '3']);
	});

	it('folds the middle of a long thread behind one row', () => {
		expect(shape(foldRows(thread(30), new Set(['m29']), false))).toEqual([
			'0',
			'fold:1+26',
			'27',
			'28',
			'29'
		]);
	});

	it('never folds a single message', () => {
		expect(shape(foldRows(thread(5), new Set(['m4']), false))).toEqual(['0', '1', '2', '3', '4']);
	});

	it('keeps an open message out of the fold', () => {
		expect(shape(foldRows(thread(12), new Set(['m11', 'm5']), false))).toEqual([
			'0',
			'fold:1+4',
			'5',
			'fold:6+3',
			'9',
			'10',
			'11'
		]);
	});

	it('shows everything once revealed', () => {
		expect(foldRows(thread(10), new Set(['m9']), true)).toHaveLength(10);
	});
});

describe('initialOpenIds', () => {
	it('opens the focus and the newest message', () => {
		expect(initialOpenIds(thread(10), 'm3').sort()).toEqual(['m3', 'm9']);
	});

	it('opens unread messages that stay visible, not folded ones', () => {
		const entries = thread(10).map((e, i) => (i === 4 || i === 8 ? { ...e, unread: true } : e));
		expect(initialOpenIds(entries, 'm9').sort()).toEqual(['m8', 'm9']);
	});

	it('does not open your own messages for being unread', () => {
		const entries = thread(3).map((e, i) => (i === 0 ? { ...e, unread: true, me: true } : e));
		expect(initialOpenIds(entries, 'm2')).toEqual(['m2']);
	});
});
