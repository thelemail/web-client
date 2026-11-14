import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

export interface ChunkNode {
	file: string;
	imports: string[];
	css: string[];
	modules: string[];
}

export function chunkGraph(appDir: string): Plugin {
	const root = join(appDir, '..', '..');
	return {
		name: 'chunk-graph',
		apply: 'build',
		generateBundle(_options, bundle) {
			const chunks: ChunkNode[] = [];
			for (const output of Object.values(bundle)) {
				if (output.type !== 'chunk') continue;
				chunks.push({
					file: output.fileName,
					imports: [...output.imports].sort(),
					css: [...(output.viteMetadata?.importedCss ?? [])].sort(),
					modules: output.moduleIds.map((id) => relative(root, id.split('?')[0])).sort()
				});
			}
			if (!chunks.some((c) => c.file.startsWith('_app/immutable/entry/'))) return;
			chunks.sort((a, b) => a.file.localeCompare(b.file));
			mkdirSync(join(appDir, 'build-meta'), { recursive: true });
			writeFileSync(join(appDir, 'build-meta', 'chunks.json'), JSON.stringify(chunks));
		}
	};
}
