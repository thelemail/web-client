import { describe, expect, it } from 'vitest';
import {
	chunk,
	hasExactName,
	labelChanges,
	labelStates,
	nextCheckState,
	searchEntries,
	type CheckState
} from './picker';
import { orderTree, type CollectionNode } from './tree';

function node(id: string, parentId: string | null, position: number, name: string): CollectionNode {
	return { id, kind: 'folder', parentId, position, rev: 1, name, color: null, favorite: false, sealed: false };
}

const entries = orderTree([
	node('work', null, 1, 'Work'),
	node('clients', 'work', 1, 'Clients'),
	node('acme', 'clients', 1, 'Acme'),
	node('home', null, 2, 'Home'),
	node('receipts', 'home', 1, 'Receipts'),
	node('workshop', null, 3, 'Workshop notes')
]);

describe('searchEntries', () => {
	it('ranks name prefixes before path and substring matches', () => {
		expect(searchEntries(entries, 'work').map((e) => e.id)).toEqual([
			'work',
			'workshop',
			'clients',
			'acme'
		]);
	});

	it('matches full paths with or without spaces around the slash', () => {
		expect(searchEntries(entries, 'work/clients/ac').map((e) => e.id)).toEqual(['acme']);
		expect(searchEntries(entries, 'Home / Rec').map((e) => e.id)).toEqual(['receipts']);
	});

	it('returns everything for an empty query and nothing for a miss', () => {
		expect(searchEntries(entries, '  ')).toHaveLength(entries.length);
		expect(searchEntries(entries, 'zzz')).toEqual([]);
	});

	it('detects an existing name or path', () => {
		expect(hasExactName(entries, 'acme')).toBe(true);
		expect(hasExactName(entries, 'work / clients')).toBe(true);
		expect(hasExactName(entries, 'acm')).toBe(false);
	});
});

describe('label states', () => {
	it('marks labels on every message as on and the rest as mixed', () => {
		const states = labelStates([
			['a', 'b'],
			['a', 'c'],
			['a', 'a']
		]);
		expect(Object.fromEntries(states)).toEqual({ a: 'on', b: 'mixed', c: 'mixed' });
	});

	it('cycles mixed through on and off and back', () => {
		let s: CheckState = 'mixed';
		const seen: CheckState[] = [];
		for (let i = 0; i < 3; i++) {
			s = nextCheckState(s, 'mixed');
			seen.push(s);
		}
		expect(seen).toEqual(['on', 'off', 'mixed']);
		expect(nextCheckState('off', 'off')).toBe('on');
		expect(nextCheckState('on', 'on')).toBe('off');
	});

	it('only sends real changes', () => {
		const initial = new Map<string, CheckState>([
			['a', 'on'],
			['b', 'mixed'],
			['c', 'mixed']
		]);
		const staged = new Map<string, CheckState>([
			['a', 'on'],
			['b', 'on'],
			['c', 'mixed'],
			['d', 'on'],
			['e', 'off']
		]);
		expect(labelChanges(initial, staged)).toEqual({ add: ['b', 'd'], remove: [] });
		staged.set('a', 'off');
		staged.set('c', 'off');
		expect(labelChanges(initial, staged)).toEqual({ add: ['b', 'd'], remove: ['a', 'c'] });
	});

	it('chunks into fixed sizes', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 3)).toEqual([]);
	});
});
