import { CONNECT, HELLO, MAX_JOB_BYTES, validRequest, type ControlEvent, type JobInput, type JobOutcome, type JobTicket } from '$core/search/parser/protocol';
import type { AssetEntry } from './assets';
import type { PoolResult } from './pool';

const NONCE = /^#n=([A-Za-z0-9_-]{22,64})$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface Runner {
	run(request: JobInput['request']): Promise<PoolResult>;
}

export interface FrameDeps {
	parentOrigin: string;
	manifest: readonly AssetEntry[];
	preload(manifest: readonly AssetEntry[]): Promise<Map<string, Uint8Array>>;
	runner(assets: Map<string, Uint8Array>): Runner;
}

function validTicket(value: unknown): value is JobTicket {
	if (!value || typeof value !== 'object') return false;
	const t = value as Record<string, unknown>;
	return (
		t.type === 'job' &&
		typeof t.jobId === 'string' &&
		ID.test(t.jobId) &&
		typeof t.source === 'string' &&
		t.source.length <= 160 &&
		Number.isSafeInteger(t.revision) &&
		Number.isSafeInteger(t.size) &&
		(t.size as number) >= 0 &&
		(t.size as number) <= MAX_JOB_BYTES
	);
}

function serveJob(ticket: JobTicket, port: MessagePort, runner: Runner): void {
	let used = false;
	const reply = (outcome: JobOutcome) => {
		port.postMessage(outcome);
		port.close();
	};
	port.onmessage = async (e: MessageEvent<JobInput>) => {
		if (used) return;
		used = true;
		port.onmessage = null;
		const input = e.data;
		if (!input || input.jobId !== ticket.jobId || !validRequest(input.request)) return reply({ jobId: ticket.jobId, ok: false, reason: 'rejected' });
		if (input.request.bytes.byteLength > ticket.size) return reply({ jobId: ticket.jobId, ok: false, reason: 'limit' });
		const r = await runner.run(input.request);
		reply(r.ok ? { jobId: ticket.jobId, ok: true, result: r.result } : { jobId: ticket.jobId, ok: false, reason: r.reason });
	};
	port.start();
}

async function accept(control: MessagePort, deps: FrameDeps): Promise<void> {
	let runner: Runner;
	try {
		runner = deps.runner(await deps.preload(deps.manifest));
	} catch {
		control.postMessage({ type: 'failed' } satisfies ControlEvent);
		control.close();
		return;
	}
	control.onmessage = (e: MessageEvent<JobTicket>) => {
		const port = e.ports[0];
		if (!port) return;
		if (!validTicket(e.data)) {
			port.close();
			return;
		}
		serveJob(e.data, port, runner);
	};
	control.start();
	control.postMessage({ type: 'ready' } satisfies ControlEvent);
}

export function startFrame(win: Window, deps: FrameDeps): boolean {
	const nonce = NONCE.exec(win.location.hash)?.[1];
	win.history.replaceState(null, '', win.location.pathname);
	if (!nonce || win.parent === win) return false;
	const listener = (e: MessageEvent<{ type?: string; nonce?: string }>) => {
		if (e.origin !== deps.parentOrigin || e.source !== win.parent) return;
		if (e.data?.type !== CONNECT || e.data.nonce !== nonce || e.ports.length !== 1) return;
		win.removeEventListener('message', listener);
		void accept(e.ports[0], deps);
	};
	win.addEventListener('message', listener);
	win.parent.postMessage({ type: HELLO }, deps.parentOrigin);
	return true;
}
