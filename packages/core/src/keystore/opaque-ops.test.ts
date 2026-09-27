import { describe, expect, it } from 'vitest';
import {
	OPAQUE_OP_TTL_MS,
	OpaqueOperations,
	settleLogin,
	wipeOpaqueOperation,
	type OpaqueOperation
} from './opaque-ops';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';

function pendingLogin(at = Date.now()): OpaqueOperation {
	return {
		kind: 'login',
		at,
		clientState: 'client-login-state',
		password: 'correct horse battery staple',
		email: 'r@thelemail.com',
		recovery: false
	};
}

function exportKey(): Uint8Array {
	return new Uint8Array(64).fill(0xa5);
}

describe('settleLogin', () => {
	it('keeps only the export key and the metadata the unlock needs', () => {
		const op = pendingLogin(0);
		const key = exportKey();

		settleLogin(op, ACCOUNT, key, 1234);

		expect(op).toEqual({
			kind: 'login',
			at: 1234,
			email: 'r@thelemail.com',
			recovery: false,
			accountId: ACCOUNT,
			exportKey: key,
			password: undefined,
			clientState: undefined
		});
	});
});

describe('wipeOpaqueOperation', () => {
	it('zeroes the export key buffer in place', () => {
		const op = pendingLogin();
		const key = exportKey();
		settleLogin(op, ACCOUNT, key);

		wipeOpaqueOperation(op);

		expect(key.every((b) => b === 0)).toBe(true);
		expect(op.exportKey).toBeUndefined();
	});

	it('zeroes the master key buffer in place', () => {
		const amk = new Uint8Array(32).fill(7);
		const op: OpaqueOperation = { kind: 'recoveryLogin', at: 0, amk };

		wipeOpaqueOperation(op);

		expect(amk.every((b) => b === 0)).toBe(true);
		expect(op.amk).toBeUndefined();
	});
});

describe('OpaqueOperations', () => {
	it('takes an operation exactly once', () => {
		const ops = new OpaqueOperations();
		const op = pendingLogin();
		ops.set('op-1', op);

		expect(ops.take('op-1')).toBe(op);
		expect(ops.take('op-1')).toBeUndefined();
		expect(ops.size).toBe(0);
	});

	it('zeroes and forgets an abandoned login', () => {
		const ops = new OpaqueOperations();
		const op = pendingLogin();
		const key = exportKey();
		settleLogin(op, ACCOUNT, key);
		ops.set('op-1', op);

		ops.abandon('op-1');

		expect(ops.get('op-1')).toBeUndefined();
		expect(key.every((b) => b === 0)).toBe(true);
	});

	it('ignores abandoning an unknown operation', () => {
		const ops = new OpaqueOperations();
		ops.set('op-1', pendingLogin());

		ops.abandon('op-2');

		expect(ops.size).toBe(1);
	});

	it('expires operations past the ttl and zeroes their keys', () => {
		const ops = new OpaqueOperations();
		const now = 10 * OPAQUE_OP_TTL_MS;
		const staleKey = exportKey();
		const freshKey = exportKey();
		const stale = pendingLogin();
		const fresh = pendingLogin();
		settleLogin(stale, ACCOUNT, staleKey, now - OPAQUE_OP_TTL_MS - 1);
		settleLogin(fresh, ACCOUNT, freshKey, now - OPAQUE_OP_TTL_MS + 1);
		ops.set('stale', stale);
		ops.set('fresh', fresh);

		ops.reap(now);

		expect(ops.get('stale')).toBeUndefined();
		expect(staleKey.every((b) => b === 0)).toBe(true);
		expect(ops.get('fresh')).toBe(fresh);
		expect(freshKey.every((b) => b === 0xa5)).toBe(true);
	});

	it('zeroes everything on clear', () => {
		const ops = new OpaqueOperations();
		const keys = [exportKey(), exportKey()];
		keys.forEach((key, i) => {
			const op = pendingLogin();
			settleLogin(op, ACCOUNT, key);
			ops.set(`op-${i}`, op);
		});

		ops.clear();

		expect(ops.size).toBe(0);
		for (const key of keys) expect(key.every((b) => b === 0)).toBe(true);
	});
});
