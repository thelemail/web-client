import type { ParsedQuery, QueryNode, Range } from './query/ast';
import { conjuncts } from './query/walk';
import type { Resolution } from './sqlite/compile';

export type ChipKind = 'scope' | 'folder' | 'label' | 'filter';

export interface Chip {
	key: string;
	text: string;
	kind: ChipKind;
	negated: boolean;
	range: Range;
	matches: number;
	descendants: number;
}

const TEXT_NODES = new Set<QueryNode['kind']>(['term', 'phrase', 'literal', 'prefix', 'and', 'or', 'around']);

function inner(node: QueryNode): { node: QueryNode; negated: boolean } {
	return node.kind === 'not' ? { node: node.child, negated: true } : { node, negated: false };
}

function kindOf(node: QueryNode): ChipKind {
	if (node.kind === 'scope') return 'scope';
	if (node.kind === 'folder') return 'folder';
	if (node.kind === 'label') return 'label';
	return 'filter';
}

export function chipsOf(query: ParsedQuery, text: string, resolved: readonly Resolution[] = []): Chip[] {
	if (!query.root) return [];
	const out: Chip[] = [];
	for (const top of conjuncts(query.root)) {
		const { node, negated } = inner(top);
		if (TEXT_NODES.has(node.kind) || node.kind === 'not') continue;
		const r = resolved.find((x) => x.range.start === node.range.start && x.range.end === node.range.end);
		out.push({
			key: `${top.range.start}:${top.range.end}`,
			text: text.slice(top.range.start, top.range.end),
			kind: kindOf(node),
			negated,
			range: top.range,
			matches: r?.ids.length ?? 0,
			descendants: r?.descendants ?? 0
		});
	}
	return out;
}

export function replaceRange(text: string, range: Range, replacement: string): string {
	return `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
}
