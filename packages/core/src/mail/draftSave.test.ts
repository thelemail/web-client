import { describe, expect, it } from 'vitest';
import { autosaveAllowed, draftSaveStatus, mayClose, type DraftSaveFacts } from './draftSave';

const ready: DraftSaveFacts = { load: 'ready', saving: false, failed: false, dirty: false, persisted: false };

describe('autosaveAllowed', () => {
	it('stays off until the draft has loaded', () => {
		expect(autosaveAllowed('loading', false)).toBe(false);
		expect(autosaveAllowed('failed', false)).toBe(false);
		expect(autosaveAllowed('ready', false)).toBe(true);
	});

	it('stays off while sending', () => {
		expect(autosaveAllowed('ready', true)).toBe(false);
	});
});

describe('draftSaveStatus', () => {
	it('reports loading and a failed load before anything else', () => {
		expect(draftSaveStatus({ ...ready, load: 'loading', dirty: true, saving: true })).toBe('loading');
		expect(draftSaveStatus({ ...ready, load: 'failed', dirty: true, failed: true })).toBe('load-failed');
	});

	it('walks a new draft from idle through unsaved and saving to saved', () => {
		expect(draftSaveStatus(ready)).toBe('idle');
		expect(draftSaveStatus({ ...ready, dirty: true })).toBe('unsaved');
		expect(draftSaveStatus({ ...ready, dirty: true, saving: true })).toBe('saving');
		expect(draftSaveStatus({ ...ready, persisted: true })).toBe('saved');
	});

	it('never says saved while a newer edit is waiting', () => {
		expect(draftSaveStatus({ ...ready, persisted: true, dirty: true })).toBe('unsaved');
	});

	it('keeps a failed save visible until a save succeeds', () => {
		expect(draftSaveStatus({ ...ready, persisted: true, dirty: true, failed: true })).toBe('failed');
		expect(draftSaveStatus({ ...ready, persisted: true, dirty: true, failed: true, saving: true })).toBe('saving');
		expect(draftSaveStatus({ ...ready, persisted: true })).toBe('saved');
	});
});

describe('mayClose', () => {
	it('closes freely when nothing was loaded to protect', () => {
		expect(mayClose({ ...ready, load: 'loading', dirty: true })).toBe(true);
		expect(mayClose({ ...ready, load: 'failed', dirty: true })).toBe(true);
	});

	it('closes only once the latest edit is safely saved', () => {
		expect(mayClose({ ...ready, persisted: true })).toBe(true);
		expect(mayClose(ready)).toBe(true);
		expect(mayClose({ ...ready, dirty: true })).toBe(false);
		expect(mayClose({ ...ready, saving: true })).toBe(false);
		expect(mayClose({ ...ready, dirty: true, failed: true })).toBe(false);
	});
});
