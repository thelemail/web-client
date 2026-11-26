import { afterBoot } from '$core/async/idle';
import { loadEditorKit } from './editor/loadKit';

export function preloadMailModules(): () => void {
	return afterBoot(() => {
		void Promise.allSettled([
			loadEditorKit(),
			import('./render/parseMime'),
			import('./render/sanitizeHtml'),
			import('$core/directory/verify'),
			import('$core/directory/delegation')
		]);
	});
}
