import type { QueryNode, WidenedScope } from './ast';
import { childrenOf } from './walk';

export function universeOf(root: QueryNode | null): WidenedScope[] {
	const found = new Set<WidenedScope>();
	const visit = (node: QueryNode, positive: boolean) => {
		if (node.kind === 'scope' && positive) {
			if (node.scope === 'spam' || node.scope === 'anywhere') found.add('spam');
			if (node.scope === 'trash' || node.scope === 'anywhere') found.add('trash');
		}
		const polarity = node.kind === 'not' ? !positive : positive;
		for (const child of childrenOf(node)) visit(child, polarity);
	};
	if (root) visit(root, true);
	return (['spam', 'trash'] as const).filter((scope) => found.has(scope));
}
