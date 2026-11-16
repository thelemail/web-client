import { describe, expect, it } from 'vitest';
import type { ChunkNode } from '../../../scripts/chunk-graph.ts';
import { ALLOWANCE, grown, initialClosure } from '../../../scripts/initial-size.ts';

const ROOT = 'apps/mail/src/routes';
const SLOT = `${ROOT}/(app)/u/[slot=accountSlot]`;

function chunk(file: string, modules: string[], imports: string[] = [], css: string[] = []): ChunkNode {
	return { file, imports, css, modules };
}

function graph(extra: ChunkNode[] = [], sharedModules: string[] = ['packages/core/src/search/lazy.ts']): ChunkNode[] {
	return [
		chunk('_app/immutable/entry/start.a.js', ['kit/start.js'], ['_app/immutable/chunks/shared.js']),
		chunk('_app/immutable/entry/app.a.js', ['kit/app.js']),
		chunk('_app/immutable/nodes/0.a.js', [`${ROOT}/+layout.svelte`], [], ['_app/immutable/assets/root.css']),
		chunk('_app/immutable/nodes/2.a.js', [`${SLOT}/+layout.svelte`], ['_app/immutable/chunks/shared.js']),
		chunk('_app/immutable/nodes/3.a.js', [`${SLOT}/mail/+layout.svelte`], ['_app/immutable/chunks/styles.js']),
		chunk('_app/immutable/nodes/4.a.js', [`${SLOT}/mail/[folder=systemFolder]/[[id]]/+page.svelte`], [], ['_app/immutable/assets/mail.css']),
		chunk('_app/immutable/nodes/9.a.js', [`${SLOT}/settings/+layout.svelte`], ['_app/immutable/chunks/settings.js']),
		chunk('_app/immutable/chunks/shared.js', sharedModules),
		chunk('_app/immutable/chunks/styles.js', ['packages/core/src/mail/list.css'], [], ['_app/immutable/assets/list.css']),
		chunk('_app/immutable/chunks/settings.js', ['packages/core/src/settings/Panel.svelte']),
		chunk('_app/immutable/chunks/lazy-search.js', ['packages/core/src/search/runtime/client.ts', 'packages/core/src/stores/searchEngine.ts']),
		...extra
	];
}

describe('initialClosure', () => {
	it('follows static imports from the entries and the mailbox route only', () => {
		const closure = initialClosure(graph());
		expect(closure.js).toEqual([
			'_app/immutable/chunks/shared.js',
			'_app/immutable/entry/app.a.js',
			'_app/immutable/entry/start.a.js',
			'_app/immutable/nodes/0.a.js',
			'_app/immutable/nodes/2.a.js',
			'_app/immutable/nodes/3.a.js',
			'_app/immutable/nodes/4.a.js'
		]);
		expect(closure.forbidden).toEqual([]);
	});

	it('collects the styles of every chunk it reaches, including style-only chunks', () => {
		expect(initialClosure(graph()).css).toEqual([
			'_app/immutable/assets/list.css',
			'_app/immutable/assets/mail.css',
			'_app/immutable/assets/root.css'
		]);
	});

	it('allows the lazy entry and the record store', () => {
		const modules = ['packages/core/src/search/lazy.ts', 'packages/core/src/search/runtime/records.ts'];
		expect(initialClosure(graph([], modules)).forbidden).toEqual([]);
	});

	it('reports search code reachable at load', () => {
		const modules = [
			'packages/core/src/search/query/parser.ts',
			'packages/core/src/search/ui.ts',
			'node_modules/.pnpm/@thelemail+sqlite-wasm@3/node_modules/@thelemail/sqlite-wasm/dist/sqlite3.mjs'
		];
		expect(initialClosure(graph([], modules)).forbidden).toEqual([...modules].sort());
	});

	it('fails loudly when the build layout changes', () => {
		expect(() => initialClosure(graph().filter((c) => !c.file.includes('entry/app')))).toThrow('entry chunks not found');
		expect(() => initialClosure(graph().filter((c) => !c.file.includes('nodes/3')))).toThrow('no chunk holds');
	});
});

describe('grown', () => {
	const baseline = { js: 800_000, css: 50_000 };

	it('accepts growth within the allowance', () => {
		expect(grown({ js: 800_000 + ALLOWANCE, css: 50_000 }, baseline)).toEqual([]);
		expect(grown({ js: 700_000, css: 40_000 }, baseline)).toEqual([]);
	});

	it('names what grew beyond it', () => {
		expect(grown({ js: 800_001 + ALLOWANCE, css: 50_000 }, baseline)).toEqual(['js']);
		expect(grown({ js: 900_000, css: 60_000 }, baseline)).toEqual(['js', 'css']);
	});
});
