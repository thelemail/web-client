import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export function moduleInventory(appDir: string, label: string): Plugin {
	const root = join(appDir, '..', '..');
	return {
		name: `module-inventory-${label}`,
		apply: 'build',
		generateBundle(_options, bundle) {
			const ids = new Set<string>();
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				for (const id of output.moduleIds) ids.add(relative(root, id.split('?')[0]));
			}
			mkdirSync(join(appDir, 'build-meta'), { recursive: true });
			appendFileSync(join(appDir, 'build-meta', 'modules.txt'), [...ids].sort().join('\n') + '\n');
		}
	};
}
