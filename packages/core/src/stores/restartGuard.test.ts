import { describe, it, expect } from 'vitest';
import { holdRestart, restartBlockers } from './restartGuard';

describe('restart guard', () => {
	it('lets a restart through when nothing holds it', async () => {
		expect(await restartBlockers()).toEqual([]);
	});

	it('collects the reason from every hold that objects', async () => {
		const releaseA = holdRestart(() => 'A message is still sending.');
		const releaseB = holdRestart(async () => null);
		const releaseC = holdRestart(async () => 'A draft could not be saved.');
		expect(await restartBlockers()).toEqual([
			'A message is still sending.',
			'A draft could not be saved.'
		]);
		releaseA();
		releaseB();
		releaseC();
		expect(await restartBlockers()).toEqual([]);
	});

	it('treats a hold that throws as a blocker', async () => {
		const release = holdRestart(async () => {
			throw new Error('network');
		});
		expect(await restartBlockers()).toEqual(['Something is still saving.']);
		release();
	});

	it('waits for a hold to finish saving before deciding', async () => {
		let saved = false;
		const release = holdRestart(async () => {
			await new Promise((r) => setTimeout(r, 5));
			saved = true;
			return null;
		});
		expect(await restartBlockers()).toEqual([]);
		expect(saved).toBe(true);
		release();
	});
});
