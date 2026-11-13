/// <reference lib="webworker" />

import type {
	CloseSearchSessionArgs,
	DeriveSearchDbKeyArgs,
	OpenSearchArtifactArgs,
	OpenSearchRootArgs,
	OpenSearchRootResponse,
	SealSearchArtifactArgs,
	SearchArtifactRef,
	SearchSessionRefusal,
	SearchSessionRequest,
	SearchSessionResponse
} from '../protocol';
import { ProductKeysError } from '../productkeys/errors';
import { parseProductBundle } from '../productkeys/productBundle';
import type { ArtifactContext } from '../searchkeys/artifact';
import { openArtifact, sealArtifact } from '../searchkeys/artifact';
import { searchDbKey } from '../searchkeys/dbKey';
import type { SearchRoot } from '../searchkeys/rootBundle';
import { openSearchRoot, sealSearchRoot } from '../searchkeys/rootBundle';
import type { VaultState } from './state';
import { onVaultGone, vaults } from './state';

const MAX_SESSIONS_PER_ACCOUNT = 8;

interface Session {
	accountId: string;
	generationId: string;
	epoch: number;
	vault: VaultState;
	port: MessagePort;
	root: Uint8Array;
}

const epochs = new Map<string, number>();
const sessions = new Set<Session>();
let everyAccountEpoch = 0;

export function unlockEpoch(accountId: string): number {
	return everyAccountEpoch + (epochs.get(accountId) ?? 0);
}

function end(s: Session): void {
	if (!sessions.delete(s)) return;
	s.root.fill(0);
	s.port.onmessage = null;
	s.port.close();
}

export function endSearchSessions(accountId: string | null): void {
	if (accountId === null) everyAccountEpoch++;
	else epochs.set(accountId, (epochs.get(accountId) ?? 0) + 1);
	for (const s of [...sessions]) {
		if (accountId === null || s.accountId === accountId) end(s);
	}
}

onVaultGone(endSearchSessions);

function live(s: Session): boolean {
	if (!sessions.has(s)) return false;
	if (s.epoch === unlockEpoch(s.accountId) && vaults.get(s.accountId) === s.vault) return true;
	end(s);
	return false;
}

function refusal(err: unknown): SearchSessionRefusal {
	if (err instanceof ProductKeysError) return { ok: false, code: err.code === 'too-large' ? 'too_large' : 'invalid' };
	throw err;
}

function context(s: Session, ref: SearchArtifactRef): ArtifactContext {
	return {
		accountId: s.accountId,
		generationId: s.generationId,
		kind: ref.kind,
		sourceKind: ref.sourceKind,
		sourceId: ref.sourceId,
		contentRevision: ref.contentRevision,
		componentEpoch: ref.componentEpoch,
		extractionRevision: ref.extractionRevision
	};
}

function bytes(v: unknown): Uint8Array {
	if (!(v instanceof Uint8Array)) throw new ProductKeysError('malformed', 'not bytes');
	return v;
}

async function run(s: Session, msg: SearchSessionRequest): Promise<{ value: unknown; transfer: Transferable[] }> {
	try {
		switch (msg.cmd) {
			case 'sealSearchArtifact': {
				const a = msg.args as SealSearchArtifactArgs;
				const artifact = await sealArtifact(s.root, context(s, a), bytes(a?.payload));
				return { value: { ok: true, artifact }, transfer: [artifact.buffer as ArrayBuffer] };
			}
			case 'openSearchArtifact': {
				const a = msg.args as OpenSearchArtifactArgs;
				const payload = await openArtifact(s.root, context(s, a), bytes(a?.artifact));
				return { value: { ok: true, payload }, transfer: [payload.buffer as ArrayBuffer] };
			}
			case 'deriveSearchDbKey': {
				const a = msg.args as DeriveSearchDbKeyArgs;
				const key = await searchDbKey(s.root, s.accountId, s.generationId, bytes(a?.installationSalt));
				return { value: { ok: true, key }, transfer: [key.buffer as ArrayBuffer] };
			}
			default:
				return { value: { ok: false, code: 'invalid' } satisfies SearchSessionRefusal, transfer: [] };
		}
	} catch (err) {
		if (err instanceof TypeError) return { value: { ok: false, code: 'invalid' } satisfies SearchSessionRefusal, transfer: [] };
		return { value: refusal(err), transfer: [] };
	}
}

async function serve(s: Session, msg: SearchSessionRequest): Promise<void> {
	if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') return;
	if (!live(s)) return;
	if (msg.cmd === 'closeSearchSession') {
		end(s);
		return;
	}
	const root = s.root.slice();
	const scoped: Session = { ...s, root };
	let out: { value: unknown; transfer: Transferable[] };
	try {
		out = await run(scoped, msg);
	} finally {
		root.fill(0);
	}
	if (!live(s)) {
		for (const t of out.transfer) new Uint8Array(t as ArrayBuffer).fill(0);
		return;
	}
	const response: SearchSessionResponse = { type: 'response', id: msg.id, value: out.value };
	s.port.postMessage(response, out.transfer);
}

function start(s: Session): void {
	const mine = [...sessions].filter((x) => x.accountId === s.accountId);
	for (const old of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_ACCOUNT + 1))) end(old);
	sessions.add(s);
	s.port.onmessage = (ev: MessageEvent<SearchSessionRequest>) => {
		void serve(s, ev.data).catch(() => end(s));
	};
	s.port.start?.();
}

export async function handleOpenSearchRoot(args: OpenSearchRootArgs): Promise<OpenSearchRootResponse> {
	const port = args?.port;
	const refuse = (code: Exclude<OpenSearchRootResponse, { ok: true }>['code']): OpenSearchRootResponse => {
		port?.close?.();
		return { ok: false, code };
	};
	const v = vaults.get(args.accountId);
	if (!v) return refuse('locked');
	if (v.product !== 'app' || !v.productRoot || v.productKeyEpoch === undefined) return refuse('unavailable');
	if (typeof port?.postMessage !== 'function' || typeof port.close !== 'function') return refuse('invalid');
	const epoch = unlockEpoch(args.accountId);
	const productRoot = v.productRoot.slice();
	let opened: SearchRoot;
	let created: Uint8Array | undefined;
	try {
		if (args.bundle !== undefined) {
			const h = parseProductBundle(bytes(args.bundle));
			if (h.accountId === args.accountId && h.product === 'app' && h.productKeyEpoch !== v.productKeyEpoch) return refuse('stale_epoch');
			opened = await openSearchRoot(productRoot, args.bundle, args.accountId, v.productKeyEpoch, []);
		} else {
			const sealed = await sealSearchRoot(productRoot, args.accountId, v.productKeyEpoch, []);
			opened = sealed.searchRoot;
			created = sealed.bundle;
		}
	} catch (err) {
		if (err instanceof ProductKeysError) return refuse('invalid');
		port.close();
		throw err;
	} finally {
		productRoot.fill(0);
	}
	if (epoch !== unlockEpoch(args.accountId) || vaults.get(args.accountId) !== v) {
		opened.root.fill(0);
		return refuse('locked');
	}
	start({ accountId: args.accountId, generationId: opened.generationId, epoch, vault: v, port, root: opened.root });
	return { ok: true, generationId: opened.generationId, unlockEpoch: epoch, ...(created ? { bundle: created } : {}) };
}

export function handleCloseSearchSession(args: CloseSearchSessionArgs): void {
	endSearchSessions(args.accountId);
}

export const SESSION_ONLY: SearchSessionRefusal = { ok: false, code: 'no_session' };
