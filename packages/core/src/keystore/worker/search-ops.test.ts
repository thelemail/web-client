// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { keyId } from '../productkeys/encoding';
import { fingerprintBytes, secretKeyBytes } from '../productkeys/pgp';
import { ENTRY } from '../productkeys/productBundle';
import { PROFILE } from '../productkeys/profiles';
import type { OpenSearchRootResponse, SearchArtifactRef } from '../protocol';
import { openSearchRoot } from '../searchkeys/rootBundle';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../idb', () => ({
	getVault: async () => null,
	getAllVaults: async () => [],
	putVault: async () => undefined,
	deleteVault: async () => undefined,
	clearAllVaults: async () => undefined
}));
vi.mock('$core/custody/store', () => ({
	getJournal: async () => null,
	getAllJournals: async () => [],
	getAllCustodyVaults: async () => [],
	forgetCustody: async () => undefined,
	forgetAllCustody: async () => undefined
}));
vi.mock('../searchkeys/artifact', async (original) => {
	const real = await original<typeof import('../searchkeys/artifact')>();
	return { ...real, sealArtifact: vi.fn(real.sealArtifact) };
});

const { sealArtifact } = await import('../searchkeys/artifact');
const { handleCloseSearchSession, handleOpenSearchRoot, unlockEpoch } = await import('./search-ops');
const { productVaultState } = await import('./product-vault');
const { handleClear, handleClearAll, handleLock, installVault, vaults } = await import('./state');
type VaultState = import('./state').VaultState;

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const OTHER = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';
const EMAIL = 'calloway@thelemail.test';
const SILENT = Symbol('silent');

const ref: SearchArtifactRef = {
	kind: 'document',
	sourceKind: 'message',
	sourceId: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
	contentRevision: 4,
	componentEpoch: 1,
	extractionRevision: 2
};

let privateKey: openpgp.PrivateKey;
const open: MessagePort[] = [];
const seen: unknown[] = [];

function productRoot(fill: number): Uint8Array {
	return new Uint8Array(32).fill(fill);
}

async function mailVault(accountId: string, fill: number, productKeyEpoch = 1): Promise<VaultState> {
	const id = keyId(accountId, fingerprintBytes(privateKey));
	return productVaultState(accountId, EMAIL, {
		product: 'app',
		root: productRoot(fill),
		currentKeyId: id,
		keys: [{ keyId: id, scopeId: accountId, purpose: ENTRY.mailIdentity, profileId: PROFILE.mailClassic, keyEpoch: 1, material: secretKeyBytes(privateKey) }],
		manifest: { manifestId: 'aaaaaaaa-0000-4000-8000-000000000001', revision: 1, hash: new Uint8Array(32), productKeyEpoch }
	});
}

async function session(accountId: string, bundle?: Uint8Array): Promise<{ res: Extract<OpenSearchRootResponse, { ok: true }>; port: MessagePort }> {
	const channel = new MessageChannel();
	open.push(channel.port1, channel.port2);
	const res = await handleOpenSearchRoot({ accountId, port: channel.port2, ...(bundle ? { bundle } : {}) });
	seen.push(res);
	if (!res.ok) throw new Error(`openSearchRoot refused: ${res.code}`);
	return { res, port: channel.port1 };
}

function ask<T>(port: MessagePort, cmd: string, args?: unknown, waitMs = 200): Promise<T | typeof SILENT> {
	const id = crypto.randomUUID();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			port.removeEventListener('message', onMessage);
			resolve(SILENT);
		}, waitMs);
		const onMessage = (ev: MessageEvent) => {
			if (ev.data?.id !== id) return;
			clearTimeout(timer);
			port.removeEventListener('message', onMessage);
			seen.push(ev.data.value);
			resolve(ev.data.value as T);
		};
		port.addEventListener('message', onMessage);
		port.start();
		port.postMessage({ id, cmd, args });
	});
}

function closed(port: MessagePort): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), 500);
		port.addEventListener('close', () => {
			clearTimeout(timer);
			resolve(true);
		});
		port.start();
	});
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
}

function byteFields(v: unknown): Uint8Array[] {
	if (v instanceof Uint8Array) return [v];
	if (!v || typeof v !== 'object') return [];
	return Object.values(v).flatMap(byteFields);
}

type Sealed = { ok: true; artifact: Uint8Array } | { ok: false; code: string };
type Opened = { ok: true; payload: Uint8Array } | { ok: false; code: string };
type Derived = { ok: true; key: Uint8Array } | { ok: false; code: string };

beforeAll(async () => {
	({ privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: EMAIL }], format: 'object', config: { v6Keys: true } }));
}, 60_000);

beforeEach(async () => {
	vaults.clear();
	seen.length = 0;
	installVault(await mailVault(ACCOUNT, 9));
	installVault(await mailVault(OTHER, 8));
});

afterEach(() => {
	vi.mocked(sealArtifact).mockClear();
	for (const p of open.splice(0)) p.close();
});

describe('search root sessions in the mail vault', () => {
	it('keeps the mail root and its epoch for a mail vault only', async () => {
		const v = vaults.get(ACCOUNT)!;
		expect(v.productRoot).toEqual(productRoot(9));
		expect(v.productKeyEpoch).toBe(1);
		const calendar = await productVaultState(ACCOUNT, EMAIL, {
			product: 'calendar',
			root: productRoot(7),
			currentKeyId: null,
			keys: [{ keyId: keyId(ACCOUNT, fingerprintBytes(privateKey)), scopeId: ACCOUNT, purpose: ENTRY.calendarIdentity, profileId: PROFILE.calendarIdentity, keyEpoch: 1, material: secretKeyBytes(privateKey) }],
			manifest: { manifestId: 'aaaaaaaa-0000-4000-8000-000000000001', revision: 1, hash: new Uint8Array(32), productKeyEpoch: 1 }
		});
		expect(calendar.productRoot).toBeUndefined();
	});

	it('mints a search root, hands back only its bundle and reopens it', async () => {
		const first = await session(ACCOUNT);
		expect(first.res.bundle).toBeInstanceOf(Uint8Array);
		const sealed = await ask<Sealed>(first.port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1, 2, 3]) });
		if (sealed === SILENT || !sealed.ok) throw new Error('seal failed');

		const second = await session(ACCOUNT, first.res.bundle);
		expect(second.res.generationId).toBe(first.res.generationId);
		expect(second.res.bundle).toBeUndefined();
		const opened = await ask<Opened>(second.port, 'openSearchArtifact', { ...ref, artifact: sealed.artifact });
		expect(opened).toEqual({ ok: true, payload: new Uint8Array([1, 2, 3]) });
	});

	it.each([
		[1, 4096],
		[4096, 8192],
		[5120, 8192]
	])('emits a %i byte payload as a %i byte object', async (n, size) => {
		const { port } = await session(ACCOUNT);
		const sealed = await ask<Sealed>(port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array(n).fill(3) });
		if (sealed === SILENT || !sealed.ok) throw new Error('seal failed');
		expect(sealed.artifact.length).toBe(size);
	});

	it('does not open an artifact under another source, revision, kind or account', async () => {
		const mine = await session(ACCOUNT);
		const sealed = await ask<Sealed>(mine.port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array(40).fill(1) });
		if (sealed === SILENT || !sealed.ok) throw new Error('seal failed');
		const changes: Partial<SearchArtifactRef>[] = [{ sourceId: '9c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f' }, { contentRevision: 5 }, { kind: 'vectors' }, { sourceKind: 'draft' }, { componentEpoch: 2 }, { extractionRevision: 3 }];
		for (const change of changes) {
			expect(await ask<Opened>(mine.port, 'openSearchArtifact', { ...ref, ...change, artifact: sealed.artifact.slice() })).toEqual({ ok: false, code: 'invalid' });
		}
		const theirs = await session(OTHER);
		expect(await ask<Opened>(theirs.port, 'openSearchArtifact', { ...ref, artifact: sealed.artifact.slice() })).toEqual({ ok: false, code: 'invalid' });
		const anotherGeneration = await session(ACCOUNT);
		expect(await ask<Opened>(anotherGeneration.port, 'openSearchArtifact', { ...ref, artifact: sealed.artifact.slice() })).toEqual({ ok: false, code: 'invalid' });
	});

	it('derives one database key per installation salt and generation', async () => {
		const first = await session(ACCOUNT);
		const salt = new Uint8Array(32).fill(4);
		const a = await ask<Derived>(first.port, 'deriveSearchDbKey', { installationSalt: salt });
		const again = await session(ACCOUNT, first.res.bundle);
		const b = await ask<Derived>(again.port, 'deriveSearchDbKey', { installationSalt: salt });
		const c = await ask<Derived>(again.port, 'deriveSearchDbKey', { installationSalt: new Uint8Array(32).fill(5) });
		if (a === SILENT || b === SILENT || c === SILENT || !a.ok || !b.ok || !c.ok) throw new Error('derive failed');
		expect(a.key.length).toBe(32);
		expect(b.key).toEqual(a.key);
		expect(c.key).not.toEqual(a.key);
		expect(await ask<Derived>(again.port, 'deriveSearchDbKey', { installationSalt: new Uint8Array(8) })).toEqual({ ok: false, code: 'invalid' });
	});

	it('returns no search root or mail root bytes from any command', async () => {
		const first = await session(ACCOUNT);
		const { root } = await openSearchRoot(productRoot(9), first.res.bundle!, ACCOUNT, 1, []);
		const sealed = await ask<Sealed>(first.port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array(100).fill(2) });
		if (sealed === SILENT || !sealed.ok) throw new Error('seal failed');
		await ask<Opened>(first.port, 'openSearchArtifact', { ...ref, artifact: sealed.artifact.slice() });
		await ask<Derived>(first.port, 'deriveSearchDbKey', { installationSalt: new Uint8Array(32).fill(4) });
		await session(ACCOUNT, first.res.bundle);
		const out = seen.flatMap(byteFields);
		expect(out.length).toBeGreaterThanOrEqual(4);
		for (const b of out) {
			expect(contains(b, root)).toBe(false);
			expect(contains(b, productRoot(9))).toBe(false);
		}
		for (const v of seen) expect(Object.keys(v as object).some((k) => /root/i.test(k))).toBe(false);
	});

	it('refuses a locked account, a legacy vault and a bundle from another epoch or account', async () => {
		const first = await session(ACCOUNT);
		const port = () => {
			const c = new MessageChannel();
			open.push(c.port1, c.port2);
			return c.port2;
		};
		expect(await handleOpenSearchRoot({ accountId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', port: port() })).toEqual({ ok: false, code: 'locked' });
		expect(await handleOpenSearchRoot({ accountId: OTHER, port: port(), bundle: first.res.bundle })).toEqual({ ok: false, code: 'invalid' });
		expect(await handleOpenSearchRoot({ accountId: ACCOUNT, port: port(), bundle: new Uint8Array([1, 2, 3]) })).toEqual({ ok: false, code: 'invalid' });

		installVault(await mailVault(ACCOUNT, 9, 2));
		expect(await handleOpenSearchRoot({ accountId: ACCOUNT, port: port(), bundle: first.res.bundle })).toEqual({ ok: false, code: 'stale_epoch' });

		const legacy = { ...vaults.get(ACCOUNT)! };
		delete legacy.product;
		delete legacy.productRoot;
		delete legacy.productKeyEpoch;
		vaults.set(ACCOUNT, legacy);
		expect(await handleOpenSearchRoot({ accountId: ACCOUNT, port: port() })).toEqual({ ok: false, code: 'unavailable' });
	});
});

describe('unlock epoch', () => {
	const endings: [string, () => unknown][] = [
		['a lock', () => handleLock({ accountId: ACCOUNT })],
		['a clear', () => handleClear({ accountId: ACCOUNT })],
		['a sign-out of every account', () => handleClearAll()],
		['a lost session or account switch', () => handleCloseSearchSession({ accountId: ACCOUNT })],
		['a new product key epoch', async () => installVault(await mailVault(ACCOUNT, 6, 2))]
	];

	it.each(endings)('drops a response that finishes after %s and closes the port', async (_name, ending) => {
		const { port, res } = await session(ACCOUNT);
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		const started = new Promise<void>((resolve) => {
			vi.mocked(sealArtifact).mockImplementationOnce(async (...args) => {
				resolve();
				await held;
				const real = await vi.importActual<typeof import('../searchkeys/artifact')>('../searchkeys/artifact');
				return real.sealArtifact(...args);
			});
		});
		const gone = closed(port);
		const answer = ask<Sealed>(port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1]) }, 400);
		await started;
		await ending();
		release();
		expect(await answer).toBe(SILENT);
		expect(await gone).toBe(true);
		expect(unlockEpoch(ACCOUNT)).toBeGreaterThan(res.unlockEpoch);
		expect(await ask<Sealed>(port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1]) }, 100)).toBe(SILENT);
	});

	it('wipes the mail root when the vault locks', async () => {
		const v = vaults.get(ACCOUNT)!;
		handleLock({ accountId: ACCOUNT });
		expect(v.productRoot).toEqual(new Uint8Array(32));
		expect(vaults.has(ACCOUNT)).toBe(false);
	});

	it('leaves another account open when one locks', async () => {
		const mine = await session(ACCOUNT);
		const theirs = await session(OTHER);
		const before = unlockEpoch(OTHER);
		handleLock({ accountId: ACCOUNT });
		expect(unlockEpoch(OTHER)).toBe(before);
		expect(await ask<Sealed>(mine.port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1]) }, 100)).toBe(SILENT);
		const sealed = await ask<Sealed>(theirs.port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1]) });
		expect(sealed !== SILENT && sealed.ok).toBe(true);
	});

	it('refuses to open a root whose vault locked while it was being unwrapped', async () => {
		const first = await session(ACCOUNT);
		const channel = new MessageChannel();
		open.push(channel.port1, channel.port2);
		const pending = handleOpenSearchRoot({ accountId: ACCOUNT, port: channel.port2, bundle: first.res.bundle });
		handleLock({ accountId: ACCOUNT });
		expect(await pending).toEqual({ ok: false, code: 'locked' });
	});

	it('keeps a session through a restore that brings back the same mail root', async () => {
		const { port, res } = await session(ACCOUNT);
		const again = await mailVault(ACCOUNT, 9);
		installVault(again);
		expect(unlockEpoch(ACCOUNT)).toBe(res.unlockEpoch);
		expect(await ask<Sealed>(port, 'sealSearchArtifact', { ...ref, payload: new Uint8Array([1]) }, 100)).toBe(SILENT);
		const fresh = await session(ACCOUNT, res.bundle);
		expect(fresh.res.generationId).toBe(res.generationId);
	});

	it('ends a session on request from its own port', async () => {
		const { port } = await session(ACCOUNT);
		const gone = closed(port);
		port.postMessage({ id: 'x', cmd: 'closeSearchSession' });
		expect(await gone).toBe(true);
	});
});
