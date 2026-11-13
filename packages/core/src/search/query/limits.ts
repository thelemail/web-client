import { fail, LIMITS, type QueryNode } from './ast';
import { childrenOf } from './walk';

export function checkLimits(root: QueryNode): void {
	let count = 0;
	const visit = (node: QueryNode, depth: number) => {
		count += 1;
		if (count > LIMITS.nodes) fail('too_many_nodes', node.range);
		if (depth > LIMITS.depth) fail('too_deep', node.range);
		for (const child of childrenOf(node)) visit(child, depth + 1);
	};
	visit(root, 1);
}
