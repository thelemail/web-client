import { describe, expect, it, vi } from 'vitest';
import { CONNECT, HELLO, type JobOutcome } from '$core/search/parser/protocol';
import { startFrame, type FrameDeps, type Runner } from './frame';

const PARENT = 'https://app.thelemail.test';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUvWx';

function fakeWindow(hash: string) {
	const listeners = new Set<(e: MessageEvent) => void>();
	const parent = { postMessage: vi.fn() };
	const win = {
		location: { hash, pathname: '/' },
		history: { replaceState: vi.fn() },
		parent,
		addEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
		removeEventListener: (_: string, fn: (e: MessageEvent) => void) => listeners.delete(fn)
	};
	const deliver = (data: unknown, origin: string, ports: MessagePort[], source: unknown = parent) => {
		for (const fn of [...listeners]) fn({ data, origin, ports, source } as unknown as MessageEvent);
	};
	return { win: win as unknown as Window, deliver, listeners };
}

function deps(runner: Runner, preload: FrameDeps['preload'] = async () => new Map()): FrameDeps {
	return { parentOrigin: PARENT, manifest: { path: '', size: 0, sha256: '', entries: [] }, preload, runner: () => runner };
}

function next<T>(port: MessagePort): Promise<T> {
	return new Promise((resolve) => {
		port.onmessage = (e) => resolve(e.data as T);
	});
}

const okRunner: Runner = {
	run: async () => ({ ok: true, result: { kind: 'file', value: { state: 'complete', parts: [{ place: 'line:1', text: 'hello' }], warnings: 0 } } })
};

async function connect(runner: Runner, preload?: FrameDeps['preload']) {
	const { win, deliver } = fakeWindow(`#n=${NONCE}`);
	expect(startFrame(win, deps(runner, preload))).toBe(true);
	const control = new MessageChannel();
	const ready = next<{ type: string }>(control.port1);
	deliver({ type: CONNECT, nonce: NONCE }, PARENT, [control.port2]);
	return { control: control.port1, ready: await ready };
}

describe('parser frame handshake', () => {
	it('ignores connects from another origin, another window or with the wrong nonce', () => {
		const { win, deliver, listeners } = fakeWindow(`#n=${NONCE}`);
		startFrame(win, deps(okRunner));
		const port = new MessageChannel().port2;
		deliver({ type: CONNECT, nonce: NONCE }, 'https://evil.test', [port]);
		deliver({ type: CONNECT, nonce: NONCE }, PARENT, [port], {});
		deliver({ type: CONNECT, nonce: 'wrong-nonce-wrong-nonce-x' }, PARENT, [port]);
		deliver({ type: CONNECT, nonce: NONCE }, PARENT, []);
		expect(listeners.size).toBe(1);
	});

	it('refuses to start without a nonce or outside a frame', () => {
		expect(startFrame(fakeWindow('').win, deps(okRunner))).toBe(false);
		const top = fakeWindow(`#n=${NONCE}`);
		(top.win as unknown as { parent: unknown }).parent = top.win;
		expect(startFrame(top.win, deps(okRunner))).toBe(false);
	});

	it('says hello to the parent only, accepts exactly one connect and clears the fragment', async () => {
		const { win, deliver, listeners } = fakeWindow(`#n=${NONCE}`);
		startFrame(win, deps(okRunner));
		expect((win.parent as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalledWith({ type: HELLO }, PARENT);
		expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/');
		deliver({ type: CONNECT, nonce: NONCE }, PARENT, [new MessageChannel().port2]);
		expect(listeners.size).toBe(0);
	});

	it('reports failed when assets do not verify', async () => {
		const { ready } = await connect(okRunner, async () => {
			throw new Error('asset hash');
		});
		expect(ready).toEqual({ type: 'failed' });
	});
});

describe('parser jobs', () => {
	async function job(ticket: Record<string, unknown>, input: unknown, runner: Runner = okRunner): Promise<JobOutcome | null> {
		const { control, ready } = await connect(runner);
		expect(ready).toEqual({ type: 'ready' });
		const channel = new MessageChannel();
		const reply = next<JobOutcome>(channel.port1);
		control.postMessage(ticket, [channel.port2]);
		channel.port1.postMessage(input);
		return Promise.race([reply, new Promise<null>((r) => setTimeout(() => r(null), 200))]);
	}

	const ticket = { type: 'job', jobId: 'j1', source: '1:m1', revision: 3, size: 10 };

	it('runs a job and answers on its own port', async () => {
		const out = await job(ticket, { jobId: 'j1', request: { kind: 'file', bytes: new Uint8Array(5), filename: 'a.txt', mime: 'text/plain' } });
		expect(out).toMatchObject({ jobId: 'j1', ok: true });
	});

	it('rejects bytes larger than the ticket allows', async () => {
		const out = await job(ticket, { jobId: 'j1', request: { kind: 'file', bytes: new Uint8Array(11), filename: 'a.txt', mime: 'text/plain' } });
		expect(out).toEqual({ jobId: 'j1', ok: false, reason: 'limit' });
	});

	it('rejects a mismatched job id or a malformed request', async () => {
		expect(await job(ticket, { jobId: 'other', request: { kind: 'mime', bytes: new Uint8Array(1) } })).toEqual({ jobId: 'j1', ok: false, reason: 'rejected' });
		expect(await job(ticket, { jobId: 'j1', request: { kind: 'eval', bytes: new Uint8Array(1) } })).toEqual({ jobId: 'j1', ok: false, reason: 'rejected' });
	});

	it('drops invalid tickets without running anything', async () => {
		const run = vi.fn(okRunner.run);
		expect(await job({ ...ticket, size: 1e12 }, { jobId: 'j1', request: { kind: 'mime', bytes: new Uint8Array(1) } }, { run })).toBeNull();
		expect(run).not.toHaveBeenCalled();
	});

	it('passes runner failures through', async () => {
		const out = await job(ticket, { jobId: 'j1', request: { kind: 'mime', bytes: new Uint8Array(1) } }, { run: async () => ({ ok: false, reason: 'timeout' }) });
		expect(out).toEqual({ jobId: 'j1', ok: false, reason: 'timeout' });
	});
});
