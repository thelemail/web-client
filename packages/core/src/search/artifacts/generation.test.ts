import { describe, expect, it, vi } from 'vitest';
import { ApiCallError, type SearchGeneration, type SearchSyncState } from '../../api/types';
import type { OpenSearchRootResponse } from '../../keystore/protocol';
import { memoryRecords } from '../runtime/records';
import { resolveSync, type GenerationDeps } from './generation';

const ACCOUNT = 'acct-1';
const LIMITS = { maxBytes: 1 << 30, maxObjects: 1000, batchItems: 200, batchBytes: 8 << 20, minArtifactBytes: 4096, maxArtifactBytes: 8 << 20, pageSize: 500 };
const SERVER_GEN = '11111111-1111-4111-8111-111111111111';
const LOCAL_GEN = '22222222-2222-4222-8222-222222222222';

function generation(id: string, bundle: number[]): SearchGeneration {
	return { generationId: id, productKeyEpoch: 3, bundle: btoa(String.fromCharCode(...bundle)), createdAt: '2026-11-17T00:00:00Z' };
}

function state(over: Partial<SearchSyncState> = {}): SearchSyncState {
	return { enabled: true, policyRevision: 1, usedBytes: 0, usedObjects: 0, limits: LIMITS, ...over };
}

async function rig(opts: {
	state: SearchSyncState;
	open?: (bundle: Uint8Array | undefined) => OpenSearchRootResponse;
	create?: GenerationDeps['create'];
}) {
	const records = memoryRecords();
	await records.put({ accountId: ACCOUNT, bundle: new Uint8Array([9]), generationId: 'local', installationSalt: new Uint8Array(32), hasIndex: true });
	const opened: (Uint8Array | undefined)[] = [];
	const deps: GenerationDeps = {
		state: vi.fn(async () => opts.state),
		create: opts.create ?? vi.fn(async (_a, body) => ({ created: { ...body, createdAt: 'now' } })),
		openRoot: vi.fn(async (args: { bundle?: Uint8Array }, port: MessagePort) => {
			opened.push(args.bundle);
			const res = opts.open?.(args.bundle) ?? (args.bundle ? { ok: true as const, generationId: SERVER_GEN, unlockEpoch: 1, productKeyEpoch: 3 } : { ok: true as const, generationId: LOCAL_GEN, unlockEpoch: 1, productKeyEpoch: 3, bundle: new Uint8Array([7]) });
			if (!res.ok) port.close();
			return res;
		}),
		records
	};
	return { deps, records, opened };
}

describe('resolveSync', () => {
	it('stays off and forgets the generation while sync is disabled', async () => {
		const { deps, records } = await rig({ state: state({ enabled: false }) });
		await records.put({ ...(await records.get(ACCOUNT))!, sync: { generationId: SERVER_GEN, bundle: new Uint8Array([1]), productKeyEpoch: 3 } });
		const r = await resolveSync(ACCOUNT, deps);
		expect(r).toMatchObject({ ok: false, reason: 'off' });
		expect((await records.get(ACCOUNT))!.sync).toBeUndefined();
		expect(deps.openRoot).not.toHaveBeenCalled();
	});

	it('creates a generation when the account has none', async () => {
		const { deps, records } = await rig({ state: state() });
		const r = await resolveSync(ACCOUNT, deps);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.attach.generationId).toBe(LOCAL_GEN);
		expect(deps.create).toHaveBeenCalledWith(ACCOUNT, { generationId: LOCAL_GEN, productKeyEpoch: 3, bundle: btoa('\x07') });
		expect((await records.get(ACCOUNT))!.sync).toEqual({ generationId: LOCAL_GEN, bundle: new Uint8Array([7]), productKeyEpoch: 3 });
		r.attach.keystore.close();
	});

	it('adopts the generation another browser registered first', async () => {
		const create = vi.fn(async () => ({ exists: generation(SERVER_GEN, [5, 5]) }));
		const { deps, opened } = await rig({ state: state(), create });
		const r = await resolveSync(ACCOUNT, deps);
		expect(r.ok && r.attach.generationId).toBe(SERVER_GEN);
		expect(opened).toEqual([undefined, new Uint8Array([5, 5])]);
		if (r.ok) r.attach.keystore.close();
	});

	it('opens the current generation without registering a new one', async () => {
		const { deps } = await rig({ state: state({ generation: generation(SERVER_GEN, [4]) }) });
		const r = await resolveSync(ACCOUNT, deps);
		expect(r.ok && r.attach.generationId).toBe(SERVER_GEN);
		expect(deps.create).not.toHaveBeenCalled();
		if (r.ok) r.attach.keystore.close();
	});

	it('starts a new generation when the stored one is from an older mail key epoch', async () => {
		const { deps } = await rig({
			state: state({ generation: generation(SERVER_GEN, [4]) }),
			open: (bundle) => (bundle ? { ok: false, code: 'stale_epoch' } : { ok: true, generationId: LOCAL_GEN, unlockEpoch: 1, productKeyEpoch: 4, bundle: new Uint8Array([8]) })
		});
		const r = await resolveSync(ACCOUNT, deps);
		expect(r.ok && r.attach.generationId).toBe(LOCAL_GEN);
		expect(deps.create).toHaveBeenCalledWith(ACCOUNT, expect.objectContaining({ productKeyEpoch: 4 }));
		if (r.ok) r.attach.keystore.close();
	});

	it('refuses a bundle whose root names another generation', async () => {
		const { deps } = await rig({
			state: state({ generation: generation(SERVER_GEN, [4]) }),
			open: () => ({ ok: true, generationId: LOCAL_GEN, unlockEpoch: 1, productKeyEpoch: 3 })
		});
		expect(await resolveSync(ACCOUNT, deps)).toMatchObject({ ok: false, reason: 'error' });
	});

	it('reports a locked vault without touching the server', async () => {
		const { deps } = await rig({ state: state(), open: () => ({ ok: false, code: 'locked' }) });
		expect(await resolveSync(ACCOUNT, deps)).toMatchObject({ ok: false, reason: 'locked' });
		expect(deps.create).not.toHaveBeenCalled();
	});

	it('waits when the server holds a newer mail key epoch', async () => {
		const create = vi.fn(async () => {
			throw new ApiCallError(409, { error: { code: 'search_product_epoch_stale', message: 'stale' } }, 'stale');
		});
		const { deps } = await rig({ state: state(), create });
		expect(await resolveSync(ACCOUNT, deps)).toMatchObject({ ok: false, reason: 'stale' });
	});

	it('reports a failed state request as an error', async () => {
		const { deps } = await rig({ state: state() });
		deps.state = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await resolveSync(ACCOUNT, deps)).toEqual({ ok: false, reason: 'error', state: null });
	});
});
