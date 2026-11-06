import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_KEY_UNSTORABLE } from './vault-wrap';

interface Sent {
	cmd: string;
	args: Record<string, unknown> | undefined;
	transfer: Transferable[];
}

const h = vi.hoisted(() => {
	const sent: Sent[] = [];
	let reply: (cmd: string, args: Record<string, unknown> | undefined) => unknown = () => undefined;
	const port = {
		onmessage: null as ((ev: { data: unknown }) => void) | null,
		postMessage(
			msg: { id: string; cmd: string; args?: Record<string, unknown> },
			transfer: Transferable[] = []
		) {
			sent.push({ cmd: msg.cmd, args: msg.args, transfer });
			queueMicrotask(() => {
				let data: Record<string, unknown>;
				try {
					data = {
						type: 'response',
						id: msg.id,
						value: reply(msg.cmd, msg.args)
					};
				} catch (err) {
					data = {
						type: 'response',
						id: msg.id,
						error: (err as Error).message
					};
				}
				port.onmessage?.({ data });
			});
		},
		start() {}
	};
	const keys = {
		create: vi.fn(async () => undefined),
		deriveWrapKey: vi.fn(
			async (): Promise<ArrayBuffer | null> => new Uint8Array(32).fill(9).buffer
		),
		remove: vi.fn(async () => undefined),
		removeAll: vi.fn(async () => undefined),
		prune: vi.fn(async () => undefined)
	};
	return {
		sent,
		port,
		keys,
		setReply(fn: typeof reply) {
			reply = fn;
		}
	};
});

vi.mock('$platform', () => ({
	platform: {
		spawnKeystore: () => ({ port: h.port, onerror: null }),
		vaultDeviceKeys: h.keys
	}
}));

const { keystore } = await import('./keystore-client');

const ACCOUNT = 'acct-1';
const SERVER_HALF = 'c2VydmVyLWhhbGY=';

function emit(data: Record<string, unknown>) {
	h.port.onmessage?.({ data });
}

beforeEach(() => {
	h.sent.length = 0;
	for (const fn of Object.values(h.keys)) fn.mockClear();
	h.keys.deriveWrapKey.mockImplementation(async () => new Uint8Array(32).fill(9).buffer);
	h.setReply(() => undefined);
});

describe('keystore client with page device keys', () => {
	it('keeps the worker path when the worker can store its key', async () => {
		await keystore.enrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(h.sent.map((s) => s.cmd)).toEqual(['enrollPersistent']);
		expect(h.sent[0].args).toEqual({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(h.keys.create).not.toHaveBeenCalled();
	});

	it('falls back to a page device key and transfers the wrap key', async () => {
		let attempt = 0;
		h.setReply((cmd) => {
			if (cmd === 'enrollPersistent' && attempt++ === 0) throw new Error(LOCAL_KEY_UNSTORABLE);
			return undefined;
		});
		await keystore.enrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(h.keys.create).toHaveBeenCalledWith(ACCOUNT);
		expect(h.keys.deriveWrapKey).toHaveBeenCalledWith(ACCOUNT, SERVER_HALF);
		const second = h.sent[1];
		expect(second.cmd).toBe('enrollPersistent');
		expect(second.args?.wrapKey).toBeInstanceOf(ArrayBuffer);
		expect(second.transfer).toEqual([second.args?.wrapKey]);
		expect(h.keys.remove).not.toHaveBeenCalled();
	});

	it('drops the new device key when the page-key enrolment fails', async () => {
		h.setReply((cmd, args) => {
			if (cmd !== 'enrollPersistent') return undefined;
			throw new Error(args?.wrapKey ? 'vault is locked' : LOCAL_KEY_UNSTORABLE);
		});
		await expect(
			keystore.enrollPersistent({
				accountId: ACCOUNT,
				serverHalf: SERVER_HALF
			})
		).rejects.toThrow('vault is locked');
		expect(h.keys.remove).toHaveBeenCalledWith(ACCOUNT);
	});

	it('does not fall back on other enrolment errors', async () => {
		h.setReply(() => {
			throw new Error('keystore: cannot enroll persistent — vault is locked');
		});
		await expect(
			keystore.enrollPersistent({
				accountId: ACCOUNT,
				serverHalf: SERVER_HALF
			})
		).rejects.toThrow('vault is locked');
		expect(h.keys.create).not.toHaveBeenCalled();
	});

	it('restores with the page wrap key when the device holds one', async () => {
		h.setReply(() => ({ ok: true, accountId: ACCOUNT }));
		await keystore.tryRestoreFromPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		const sent = h.sent[0];
		expect(sent.args?.wrapKey).toBeInstanceOf(ArrayBuffer);
		expect(sent.transfer).toEqual([sent.args?.wrapKey]);
	});

	it('restores through the worker alone when the device holds no key', async () => {
		h.keys.deriveWrapKey.mockImplementation(async () => null);
		h.setReply(() => ({ ok: true, accountId: ACCOUNT }));
		await keystore.tryRestoreFromPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(h.sent[0].args).toEqual({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(h.sent[0].transfer).toEqual([]);
	});

	it('removes the device key on disable, invalidate and clear, even when the worker fails', async () => {
		h.setReply(() => {
			throw new Error('worker gone');
		});
		await expect(keystore.disablePersistent({ accountId: ACCOUNT })).rejects.toThrow('worker gone');
		await expect(keystore.invalidatePersistedVault({ accountId: ACCOUNT })).rejects.toThrow();
		await expect(keystore.clear({ accountId: ACCOUNT })).rejects.toThrow();
		await expect(keystore.clearAll()).rejects.toThrow();
		expect(h.keys.remove).toHaveBeenCalledTimes(3);
		expect(h.keys.removeAll).toHaveBeenCalledTimes(1);
	});

	it('follows other tabs: broadcasts remove the matching device keys', () => {
		emit({ type: 'persistentDisabled', accountId: 'a' });
		emit({ type: 'cleared', accountId: 'b' });
		emit({ type: 'locked', accountId: 'c' });
		emit({ type: 'clearedAll' });
		expect(h.keys.remove.mock.calls).toEqual([['a'], ['b']]);
		expect(h.keys.removeAll).toHaveBeenCalledTimes(1);
	});

	it('prunes device keys once, keeping accounts that still persist', async () => {
		h.setReply(() => ({
			accounts: [
				{ accountId: 'keep', hasPersistent: true },
				{ accountId: 'drop', hasPersistent: false }
			]
		}));
		await keystore.status();
		await keystore.status();
		expect(h.keys.prune).toHaveBeenCalledTimes(1);
		expect([...(h.keys.prune.mock.calls[0] as unknown as [Set<string>])[0]]).toEqual(['keep']);
	});
});
