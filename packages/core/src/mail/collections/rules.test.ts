import { describe, expect, it } from 'vitest';
import { ApiCallError } from '$core/api/types';
import { collectionErrorText, heightOf, levelOf, moveProblem, nameProblem } from './rules';
import type { CollectionNode } from './tree';

function node(id: string, name: string, parentId: string | null = null, over: Partial<CollectionNode> = {}): CollectionNode {
	return { id, kind: 'folder', parentId, position: 1024, rev: 1, name, color: null, favorite: false, sealed: false, ...over };
}

const nodes = [
	node('a', 'Clients'),
	node('b', 'Acme', 'a'),
	node('c', 'Invoices', 'b'),
	node('d', 'Acme'),
	node('l', 'Acme', null, { kind: 'label' }),
	node('s', 'Locked', null, { sealed: true })
];

describe('collection name rules', () => {
	it('requires a name without slashes within the length limit', () => {
		expect(nameProblem(nodes, 'folder', null, '   ')).toBe('empty');
		expect(nameProblem(nodes, 'folder', null, 'x'.repeat(121))).toBe('too_long');
		expect(nameProblem(nodes, 'folder', null, ` ${'x'.repeat(120)} `)).toBeNull();
		expect(nameProblem(nodes, 'folder', null, 'Work/Home')).toBe('slash');
	});

	it('rejects a sibling of the same kind with the same name in any case', () => {
		expect(nameProblem(nodes, 'folder', null, ' acme ')).toBe('duplicate');
		expect(nameProblem(nodes, 'folder', 'b', 'acme')).toBeNull();
		expect(nameProblem(nodes, 'label', 'a', 'acme')).toBeNull();
		expect(nameProblem(nodes, 'folder', null, 'ACME', 'd')).toBeNull();
		expect(nameProblem(nodes, 'folder', null, 'locked')).toBeNull();
	});
});

describe('collection move rules', () => {
	it('measures levels from the root and heights down to the deepest leaf', () => {
		expect(levelOf(nodes, 'a')).toBe(1);
		expect(levelOf(nodes, 'c')).toBe(3);
		expect(heightOf(nodes, 'a')).toBe(3);
		expect(heightOf(nodes, 'c')).toBe(1);
	});

	it('refuses its own subtree, the other kind and name clashes', () => {
		expect(moveProblem(nodes, 'a', 'c')).toBe('inside');
		expect(moveProblem(nodes, 'a', 'a')).toBe('inside');
		expect(moveProblem(nodes, 'a', 'l')).toBe('missing');
		expect(moveProblem(nodes, 'a', 'gone')).toBe('missing');
		expect(moveProblem(nodes, 'b', null)).toBe('duplicate');
		expect(moveProblem(nodes, 'c', null)).toBeNull();
		expect(moveProblem(nodes, 'd', 'c')).toBeNull();
	});
});

describe('collection error text', () => {
	it('names the server conflicts instead of showing raw text', () => {
		const conflict = (message: string) =>
			new ApiCallError(409, { error: { code: 'conflict', message } }, message);
		expect(collectionErrorText(conflict("move or delete what's inside first"), 'folder', 'x')).toBe(
			'Move or delete its subfolders first.'
		);
		expect(collectionErrorText(conflict('this folder or label changed on another device'), 'label', 'x')).toBe(
			'This changed on another device. Check it and try again.'
		);
		expect(collectionErrorText(new ApiCallError(500, null, 'boom'), 'folder', 'fallback')).toBe('fallback');
	});
});
