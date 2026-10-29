import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	putDraft: vi.fn(),
	buildDraftEnvelope: vi.fn(),
	packDraftBundle: vi.fn(),
	uploadDraftBundle: vi.fn()
}));

vi.mock('$core/api/drafts', () => ({ putDraft: api.putDraft }));
vi.mock('./draft', () => ({
	buildDraftEnvelope: api.buildDraftEnvelope,
	packDraftBundle: api.packDraftBundle,
	uploadDraftBundle: api.uploadDraftBundle
}));

import { DraftSaver, type DraftSource } from './draftSaver.svelte';
import type { DraftDoc } from './draft';

function doc(subject: string): DraftDoc {
	return {
		v: 2,
		from: { email: 'me@a.test', name: 'Me' },
		to: [],
		cc: [],
		bcc: [],
		subject,
		bodyHtml: '',
		bodyText: '',
		attachments: []
	};
}

function source(state: { subject: string; allowed?: boolean }, saved?: DraftSource['saved']): DraftSource {
	return {
		allowed: () => state.allowed ?? true,
		key: () => state.subject,
		worth: () => state.subject !== '',
		attachments: () => [],
		doc: () => doc(state.subject),
		saved
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	api.buildDraftEnvelope.mockResolvedValue({ sealed: 'x' });
	api.putDraft.mockResolvedValue({});
});

describe('DraftSaver', () => {
	it('encrypts with the account it was created for', async () => {
		const saver = new DraftSaver('acc-a', source({ subject: 'Hi' }));
		await saver.settle();
		expect(api.buildDraftEnvelope).toHaveBeenCalledWith('acc-a', doc('Hi'), undefined);
		expect(api.putDraft).toHaveBeenCalledTimes(1);
		expect(saver.persisted).toBe(true);
	});

	it('does not save while not allowed or before there is anything worth keeping', async () => {
		const state = { subject: 'Hi', allowed: false };
		const saver = new DraftSaver('acc-a', source(state));
		await saver.settle();
		state.allowed = true;
		state.subject = '';
		await saver.settle();
		expect(api.putDraft).not.toHaveBeenCalled();
		expect(saver.id).toBeNull();
	});

	it('marks a failed save and recovers on the next one', async () => {
		const state = { subject: 'Hi' };
		const saver = new DraftSaver('acc-a', source(state));
		api.putDraft.mockRejectedValueOnce(new Error('offline'));
		await saver.settle();
		expect(saver.failed).toBe(true);
		expect(saver.persisted).toBe(false);
		await saver.settle();
		expect(saver.failed).toBe(false);
		expect(saver.persisted).toBe(true);
	});

	it('skips a save when nothing changed since the last one', async () => {
		const saver = new DraftSaver('acc-a', source({ subject: 'Hi' }));
		await saver.settle();
		await saver.settle();
		expect(api.putDraft).toHaveBeenCalledTimes(1);
	});

	it('settles only after an edit made during a save has also been saved', async () => {
		const state = { subject: 'One' };
		const saved = vi.fn();
		const saver = new DraftSaver('acc-a', source(state, saved));
		let release!: () => void;
		api.putDraft.mockImplementationOnce(() => new Promise((r) => (release = () => r({}))));
		const first = saver.save();
		await vi.waitFor(() => expect(api.putDraft).toHaveBeenCalledTimes(1));
		state.subject = 'Two';
		const settled = saver.settle();
		release();
		await first;
		await settled;
		expect(api.putDraft).toHaveBeenCalledTimes(2);
		expect(saver.lastKey).toBe('Two');
		expect(saved).toHaveBeenLastCalledWith(saver.id, doc('Two'));
	});

	it('keeps the same draft id across saves and forgets it on release', async () => {
		const state = { subject: 'One' };
		const saver = new DraftSaver('acc-a', source(state), 'draft-1');
		await saver.settle();
		state.subject = 'Two';
		await saver.settle();
		expect(api.putDraft.mock.calls.map((c) => c[0])).toEqual(['draft-1', 'draft-1']);
		expect(saver.release()).toBe('draft-1');
		expect(saver.id).toBeNull();
	});
});
