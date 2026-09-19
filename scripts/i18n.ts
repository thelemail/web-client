import type { CompilerOptions } from '@inlang/paraglide-js';

export function i18nOptions(outdir: string): CompilerOptions {
	return {
		project: '../../packages/core/project.inlang',
		outdir,
		strategy: ['baseLocale'],
		emitTsDeclarations: true
	};
}
