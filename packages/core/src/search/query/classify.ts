import type { Eligibility, QueryNode } from './ast';
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
