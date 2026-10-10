import { describe, it, expect, vi, afterEach } from 'vitest';
import { electLeader, supportsElection } from './leader';

function stubLocks(impl: (...args: unknown[]) => Promise<unknown>) {
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: { request: impl }
	});
}

function clearLocks() {
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: undefined
	});
}

describe('electLeader', () => {
	afterEach(() => {
		clearLocks();
	});

	it('reports supportsElection false when navigator.locks is absent', () => {
		clearLocks();
		expect(supportsElection()).toBe(false);
	});

	it('reports supportsElection true when navigator.locks is present', () => {
		stubLocks(vi.fn());
		expect(supportsElection()).toBe(true);
	});

	it('never calls onLead while the lock is held elsewhere', async () => {
		stubLocks(vi.fn(() => new Promise(() => {})));
		const onLead = vi.fn(() => vi.fn());
		const handle = electLeader('test-lock', onLead);
		await Promise.resolve();
		await Promise.resolve();
		expect(onLead).not.toHaveBeenCalled();
		expect(handle.isLeader).toBe(false);
		handle.stop();
	});

	it('calls onLead once the lock is acquired, and its cleanup fires on stop()', async () => {
		let released: (() => void) | null = null;
		stubLocks(
			vi.fn((..._args: unknown[]) => {
				const cb = _args[2] as (lock: Lock) => Promise<unknown>;
				const p = cb({ name: 'test-lock', mode: 'exclusive' } as Lock);
				released = () => {
					/* the real API resolves cb's own promise on abort; nothing to do here */
				};
				return p;
			})
		);
		const cleanup = vi.fn();
		const onLead = vi.fn(() => cleanup);
		const handle = electLeader('test-lock', onLead);
		await Promise.resolve();
		await Promise.resolve();

		expect(onLead).toHaveBeenCalledTimes(1);
		expect(handle.isLeader).toBe(true);

		handle.stop();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(handle.isLeader).toBe(false);
		void released;
	});

	it('releases the held lock on stop() so a later election can lead', async () => {
		let held: Promise<unknown> | null = null;
		stubLocks(
			vi.fn((...args: unknown[]) => {
				const cb = args[2] as (lock: Lock) => Promise<unknown>;
				held = cb({ name: 'test-lock', mode: 'exclusive' } as Lock);
				return held;
			})
		);
		const handle = electLeader('test-lock', () => vi.fn());
		await Promise.resolve();
		expect(handle.isLeader).toBe(true);

		const settled = vi.fn();
		void held!.then(settled);
		handle.stop();
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toHaveBeenCalledTimes(1);
	});

	it('runs onLead immediately when navigator.locks is unsupported, and is always leader', () => {
		clearLocks();
		const cleanup = vi.fn();
		const onLead = vi.fn(() => cleanup);
		const handle = electLeader('test-lock', onLead);

		expect(onLead).toHaveBeenCalledTimes(1);
		expect(handle.isLeader).toBe(true);

		handle.stop();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
