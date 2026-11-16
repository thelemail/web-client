import type { ChunkNode } from './chunk-graph.ts';

export const ALLOWANCE = 2048;

export interface Sizes {
	js: number;
	css: number;
}

export interface Closure {
	js: string[];
	css: string[];
	forbidden: string[];
}

const ROUTES = [
	'apps/mail/src/routes/+layout.svelte',
	'apps/mail/src/routes/(app)/u/[slot=accountSlot]/+layout.svelte',
	'apps/mail/src/routes/(app)/u/[slot=accountSlot]/mail/+layout.svelte',
	'apps/mail/src/routes/(app)/u/[slot=accountSlot]/mail/[folder=systemFolder]/[[id]]/+page.svelte'
];

const FORBIDDEN = [
	/packages\/core\/src\/search\/(?!lazy\.ts$|runtime\/records\.ts$)/,
	/node_modules\/.*@thelemail\/sqlite-wasm\//
];

export function initialClosure(chunks: readonly ChunkNode[]): Closure {
	const byFile = new Map(chunks.map((c) => [c.file, c]));
	const roots = chunks.filter((c) => /^_app\/immutable\/entry\/(start|app)\./.test(c.file));
	if (roots.length < 2) throw new Error('entry chunks not found');
	for (const route of ROUTES) {
		const holders = chunks.filter((c) => c.modules.includes(route));
		const node = holders.find((c) => c.file.startsWith('_app/immutable/nodes/')) ?? holders[0];
		if (!node) throw new Error(`no chunk holds ${route}`);
		roots.push(node);
	}
	const seen = new Set<string>();
	const queue = [...roots];
	while (queue.length) {
		const chunk = queue.pop()!;
		if (seen.has(chunk.file)) continue;
		seen.add(chunk.file);
		for (const file of chunk.imports) {
			const next = byFile.get(file);
			if (next) queue.push(next);
		}
	}
	const closure = [...seen].sort().map((file) => byFile.get(file)!);
	return {
		js: closure.filter((c) => !c.modules.length || c.modules.some((id) => !id.endsWith('.css'))).map((c) => c.file),
		css: [...new Set(closure.flatMap((c) => c.css))].sort(),
		forbidden: [...new Set(closure.flatMap((c) => c.modules.filter((id) => FORBIDDEN.some((re) => re.test(id)))))].sort()
	};
}

export function grown(measured: Sizes, baseline: Sizes, allowance: number = ALLOWANCE): (keyof Sizes)[] {
	return (['js', 'css'] as const).filter((kind) => measured[kind] > baseline[kind] + allowance);
}
