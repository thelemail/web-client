export type DraftLoad = 'loading' | 'failed' | 'ready';

export type DraftSaveStatus = 'loading' | 'load-failed' | 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed';

export interface DraftSaveFacts {
	load: DraftLoad;
	saving: boolean;
	failed: boolean;
	dirty: boolean;
	persisted: boolean;
}

export function autosaveAllowed(load: DraftLoad, sending: boolean): boolean {
	return load === 'ready' && !sending;
}

export function draftSaveStatus(f: DraftSaveFacts): DraftSaveStatus {
	if (f.load === 'loading') return 'loading';
	if (f.load === 'failed') return 'load-failed';
	if (f.saving) return 'saving';
	if (f.failed) return 'failed';
	if (f.dirty) return 'unsaved';
	return f.persisted ? 'saved' : 'idle';
}

export function mayClose(f: DraftSaveFacts): boolean {
	if (f.load !== 'ready') return true;
	return !f.saving && !f.failed && !f.dirty;
}
