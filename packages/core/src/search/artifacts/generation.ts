import type { GenerationResult } from '../../api/searchSync';
import { ApiCallError, type SearchGeneration, type SearchSyncState } from '../../api/types';
import type { OpenSearchRootResponse } from '../../keystore/protocol';
import { base64ToBytes, bytesToBase64 } from '../../keystore/opaque-params';
import type { SyncAttach } from '../runtime/protocol';
import type { RecordStore, SearchRecord } from '../runtime/records';

const ATTEMPTS = 3;

export interface GenerationDeps {
	state(accountId: string): Promise<SearchSyncState>;
	create(accountId: string, body: { generationId: string; productKeyEpoch: number; bundle: string }): Promise<GenerationResult>;
	openRoot(args: { accountId: string; bundle?: Uint8Array }, port: MessagePort): Promise<OpenSearchRootResponse>;
	records: RecordStore;
}

export type SyncFailure = 'off' | 'locked' | 'unavailable' | 'stale' | 'error';

export type Resolved = { ok: true; attach: SyncAttach; state: SearchSyncState } | { ok: false; reason: SyncFailure; state: SearchSyncState | null };

type Opened = { ok: true; port: MessagePort; generationId: string; productKeyEpoch: number; bundle?: Uint8Array } | { ok: false; code: Exclude<OpenSearchRootResponse, { ok: true }>['code'] };

async function open(deps: GenerationDeps, accountId: string, bundle?: Uint8Array): Promise<Opened> {
	const channel = new MessageChannel();
	const res = await deps.openRoot(bundle ? { accountId, bundle } : { accountId }, channel.port2);
	if (!res.ok) {
		channel.port1.close();
		return res;
	}
	return { ok: true, port: channel.port1, generationId: res.generationId, productKeyEpoch: res.productKeyEpoch, bundle: res.bundle };
}

function code(error: unknown): string | null {
	return error instanceof ApiCallError ? (error.envelope?.error?.code ?? null) : null;
}

async function save(deps: GenerationDeps, accountId: string, sync: SearchRecord['sync']): Promise<boolean> {
	const record = await deps.records.get(accountId);
	if (!record) return false;
	if (sync || record.sync) await deps.records.put({ ...record, sync });
	return true;
}

function decode(g: SearchGeneration): Uint8Array | null {
	try {
		return base64ToBytes(g.bundle);
	} catch {
		return null;
	}
}

export async function resolveSync(accountId: string, deps: GenerationDeps): Promise<Resolved> {
	let state: SearchSyncState;
	try {
		state = await deps.state(accountId);
	} catch {
		return { ok: false, reason: 'error', state: null };
	}
	const fail = (reason: SyncFailure): Resolved => ({ ok: false, reason, state });
	if (!state.enabled) {
		await save(deps, accountId, undefined);
		return fail('off');
	}
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const record = await deps.records.get(accountId);
		if (!record) return fail('error');
		const server = state.generation;
		if (server) {
			const bundle = record.sync?.generationId === server.generationId ? record.sync.bundle : decode(server);
			if (!bundle) return fail('error');
			const opened = await open(deps, accountId, bundle);
			if (opened.ok) {
				if (opened.generationId !== server.generationId) {
					opened.port.close();
					return fail('error');
				}
				await save(deps, accountId, { generationId: server.generationId, bundle, productKeyEpoch: server.productKeyEpoch });
				return { ok: true, attach: { keystore: opened.port, generationId: server.generationId, limits: state.limits }, state };
			}
			if (opened.code === 'locked' || opened.code === 'unavailable') return fail(opened.code);
			if (opened.code !== 'stale_epoch') return fail('error');
		}
		const fresh = await open(deps, accountId);
		if (!fresh.ok) return fail(fresh.code === 'locked' || fresh.code === 'unavailable' ? fresh.code : 'error');
		if (!fresh.bundle) {
			fresh.port.close();
			return fail('error');
		}
		let created: GenerationResult;
		try {
			created = await deps.create(accountId, { generationId: fresh.generationId, productKeyEpoch: fresh.productKeyEpoch, bundle: bytesToBase64(fresh.bundle) });
		} catch (error) {
			fresh.port.close();
			const c = code(error);
			if (c === 'search_sync_disabled') {
				await save(deps, accountId, undefined);
				return { ok: false, reason: 'off', state: { ...state, enabled: false } };
			}
			if (c === 'search_product_epoch_stale') return fail('stale');
			return fail('error');
		}
		if ('created' in created) {
			await save(deps, accountId, { generationId: fresh.generationId, bundle: fresh.bundle, productKeyEpoch: fresh.productKeyEpoch });
			const generation = created.created;
			return { ok: true, attach: { keystore: fresh.port, generationId: fresh.generationId, limits: state.limits }, state: { ...state, generation } };
		}
		fresh.port.close();
		state = { ...state, generation: created.exists };
	}
	return fail('error');
}
