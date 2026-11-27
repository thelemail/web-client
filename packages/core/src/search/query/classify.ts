import type { Eligibility, QueryNode, TermNode } from './ast';
import { childrenOf, conjuncts } from './walk';

const MANDATORY_TEXT = new Set<QueryNode['kind']>(['phrase', 'literal']);

function isAtom(node: QueryNode): boolean {
	return childrenOf(node).length === 0 && node.kind !== 'prefix';
}

function scopedTextAllowed(node: QueryNode): boolean {
	if (MANDATORY_TEXT.has(node.kind)) return true;
	if (node.kind === 'and') return node.children.every(scopedTextAllowed);
	return false;
}

export function eligibilityOf(root: QueryNode | null): Eligibility {
	if (!root) return 'words';
	const parts = conjuncts(root);
	let ordinary = 0;
	for (const part of parts) {
		switch (part.kind) {
			case 'term':
				if (part.lane !== 'word') return 'words';
				ordinary += 1;
				break;
			case 'not':
				if (!isAtom(part.child)) return 'words';
				break;
			case 'field':
				if (!scopedTextAllowed(part.child)) return 'words';
				break;
			case 'participant':
				if (part.value.kind === 'name' && part.value.prefix) return 'words';
				break;
			case 'or':
			case 'around':
			case 'prefix':
				return 'words';
			default:
				break;
		}
	}
	if (ordinary === 0) return 'words';
	return ordinary >= 2 ? 'related' : 'meaning';
}

export interface MeaningSplit {
	text: string;
	rest: QueryNode | null;
	lexical: QueryNode;
}

export function relatedAllowed(eligibility: Eligibility, exactMatches: number): boolean {
	if (eligibility === 'related') return true;
	return eligibility === 'meaning' && exactMatches === 0;
}

export function meaningSplit(root: QueryNode | null): MeaningSplit | null {
	if (!root || eligibilityOf(root) === 'words') return null;
	const words: TermNode[] = [];
	const rest: QueryNode[] = [];
	for (const part of conjuncts(root)) {
		if (part.kind === 'term' && part.lane === 'word') words.push(part);
		else rest.push(part);
	}
	const any: QueryNode = words.length === 1 ? words[0] : { kind: 'or', children: words, range: root.range };
	return {
		text: words.map((w) => w.text).join(' '),
		rest: rest.length === 0 ? null : rest.length === 1 ? rest[0] : { kind: 'and', children: rest, range: root.range },
		lexical: rest.length === 0 ? any : { kind: 'and', children: [...rest, any], range: root.range }
	};
}
