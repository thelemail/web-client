import type { QueryNode } from './ast';

export function childrenOf(node: QueryNode): QueryNode[] {
	switch (node.kind) {
		case 'and':
		case 'or':
			return node.children;
		case 'not':
		case 'field':
			return [node.child];
		case 'around':
			return [node.left, node.right];
		default:
			return [];
	}
}
