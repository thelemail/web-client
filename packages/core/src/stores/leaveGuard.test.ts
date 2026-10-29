import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdLeave, leavePending, settleForLeave, type LeaveGuard } from './leaveGuard';

const releases: (() => void)[] = [];

function guard(over: Partial<LeaveGuard> = {}): LeaveGuard {
	const g: LeaveGuard = { pending: () => true, settle: async () => true, ...over };
	releases.push(holdLeave(g));
	return g;
}

afterEach(() => {
	while (releases.length) releases.pop()!();
});

describe('leave guard', () => {
	it('lets navigation through when nothing is pending', async () => {
		guard({ pending: () => false, settle: vi.fn() });
		expect(leavePending()).toBe(false);
		expect(await settleForLeave()).toBe(true);
	});

	it('saves every pending editor before leaving', async () => {
		const a = vi.fn(async () => true);
		const b = vi.fn(async () => true);
		guard({ settle: a });
		guard({ settle: b });
		expect(leavePending()).toBe(true);
		expect(await settleForLeave()).toBe(true);
		expect(a).toHaveBeenCalledOnce();
		expect(b).toHaveBeenCalledOnce();
	});

	it('blocks leaving and focuses the editor whose save failed', async () => {
		const okFocus = vi.fn();
		const badFocus = vi.fn();
		guard({ settle: async () => true, focus: okFocus });
		guard({ settle: async () => false, focus: badFocus });
		expect(await settleForLeave()).toBe(false);
		expect(badFocus).toHaveBeenCalledOnce();
		expect(okFocus).not.toHaveBeenCalled();
	});

	it('treats a save that throws as a failed save', async () => {
		guard({ settle: async () => Promise.reject(new Error('offline')) });
		expect(await settleForLeave()).toBe(false);
	});

	it('stops guarding an editor once it is released', async () => {
		const settle = vi.fn(async () => false);
		const release = holdLeave({ pending: () => true, settle });
		release();
		expect(leavePending()).toBe(false);
		expect(await settleForLeave()).toBe(true);
		expect(settle).not.toHaveBeenCalled();
	});
});
