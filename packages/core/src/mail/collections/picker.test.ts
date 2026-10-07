import { describe, expect, it } from 'vitest';
import {
	chunk,
	createTarget,
	hasExactName,
	labelChanges,
	labelStates,
	labelStatesFromTallies,
	nextCheckState,
	searchEntries,
	tallyOf,
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

describe('createTarget', () => {
	it('offers a blank create for an empty query', () => {
		expect(createTarget(entries, ' ')).toEqual({ name: '', parent: null });
	});

	it('creates at the top level for a plain name and not for an existing one', () => {
		expect(createTarget(entries, 'Travel')).toEqual({ name: 'Travel', parent: null });
		expect(createTarget(entries, 'acme')).toBeNull();
	});

	it('creates inside the folder a path query names', () => {
		const target = createTarget(entries, 'work / clients/ Beta');
		expect(target?.name).toBe('Beta');
		expect(target?.parent?.id).toBe('clients');
	});

	it('refuses a path whose parent does not exist or whose name is empty', () => {
		expect(createTarget(entries, 'nowhere/Beta')).toBeNull();
		expect(createTarget(entries, 'work/')).toBeNull();
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

describe('labelStatesFromTallies', () => {
	it('marks a label on only when every message in every conversation carries it', () => {
		const states = labelStatesFromTallies([
			{ counts: { paid: 3, client: 1 }, total: 3 },
			tallyOf(['paid'])
		]);
		expect(states.get('paid')).toBe('on');
		expect(states.get('client')).toBe('mixed');
		expect(states.has('other')).toBe(false);
	});

	it('treats a conversation with the label on some messages as mixed', () => {
		expect(labelStatesFromTallies([{ counts: { paid: 1 }, total: 4 }]).get('paid')).toBe('mixed');
	});

	it('ignores empty tallies', () => {
		expect(labelStatesFromTallies([{ counts: { paid: 0 }, total: 2 }]).size).toBe(0);
		expect(labelStatesFromTallies([]).size).toBe(0);
	});
});
