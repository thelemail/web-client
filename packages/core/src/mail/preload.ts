import { afterBoot } from '$core/async/idle';
import { loadEditorKit } from './editor/loadKit';

export function preloadMailModules(): () => void {
	return afterBoot(() => {
		void loadEditorKit().catch(() => {});
	});
}
