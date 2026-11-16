import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { keyId } from '../../keystore/productkeys/encoding';
import { fingerprintBytes, secretKeyBytes } from '../../keystore/productkeys/pgp';
import { ENTRY } from '../../keystore/productkeys/productBundle';
import { PROFILE } from '../../keystore/productkeys/profiles';
import { parseQuery } from '../query';
import { SNAPSHOT } from '../sqlite/harness';
import { SearchClient, type ClientDeps, type ClientState } from './client';
import { directoryFor } from './protocol';
import { memoryPrefs, memoryRecords, type RecordStore } from './records';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../../keystore/idb', () => ({
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

const { handleOpenSearchRoot } = await import('../../keystore/worker/search-ops');
const { productVaultState } = await import('../../keystore/worker/product-vault');
const { handleLock, installVault, vaults } = await import('../../keystore/worker/state');

const EMAIL = 'calloway@thelemail.test';
const WAIT_MS = 60_000;

let privateKey: openpgp.PrivateKey;
let accountId: string;
let records: RecordStore;
const clients: SearchClient[] = [];
const accounts: string[] = [];

async function install(fill: number, productKeyEpoch = 1): Promise<void> {
	const id = keyId(accountId, fingerprintBytes(privateKey));
	installVault(
		await productVaultState(accountId, EMAIL, {
			product: 'app',
			root: new Uint8Array(32).fill(fill),
			currentKeyId: id,
			keys: [{ keyId: id, scopeId: accountId, purpose: ENTRY.mailIdentity, profileId: PROFILE.mailClassic, keyEpoch: 1, material: secretKeyBytes(privateKey) }],
			manifest: { manifestId: 'aaaaaaaa-0000-4000-8000-000000000001', revision: 1, hash: new Uint8Array(32), productKeyEpoch }
		})
	);
}

function client(): SearchClient {
	const deps: ClientDeps = {
		spawn: () => new Worker(new URL('./synthetic.worker.ts', import.meta.url), { type: 'module' }),
		broker: () => new SharedWorker(new URL('./broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port,
		openRoot: (args, port) => handleOpenSearchRoot({ ...args, port }),
		records,
		prefs: memoryPrefs(),
		locks: navigator.locks,
		watch: (report) => {
			report({ visible: true, idle: true, constrained: false });
			return () => {};
		}
	};
	const c = new SearchClient(accountId, deps);
	clients.push(c);
	return c;
}

function until(c: SearchClient, test: (state: ClientState) => boolean): Promise<ClientState> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`timed out in ${JSON.stringify(c.state)}`));
		}, WAIT_MS);
		const stop = c.subscribe((state) => {
			if (!test(state)) return;
			clearTimeout(timer);
			queueMicrotask(() => stop());
			resolve(state);
		});
	});
}

const owner = (state: ClientState) => state.phase === 'ready' && state.role === 'owner';
const indexed = (n: number) => (state: ClientState) => state.phase === 'ready' && state.status?.sources === n && state.status.working === null;

async function matches(c: SearchClient, input: string): Promise<number> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const reply = await c.query(parsed.query, { identities: [], folders: [], labels: [], attachmentText: true }, { sort: 'newest', group: 'message' });
	if (!reply.ok) throw new Error('query failed');
	await c.closeQuery(reply.summary.id);
	return reply.summary.matches;
}

beforeAll(async () => {
	({ privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: EMAIL }], format: 'object', config: { v6Keys: true } }));
}, 60_000);

beforeEach(async () => {
	vaults.clear();
	accountId = crypto.randomUUID();
	accounts.push(accountId);
	records = memoryRecords();
	await install(9);
});

afterEach(async () => {
	for (const c of clients.splice(0)) await c.shutdown();
	const root = await navigator.storage.getDirectory().catch(() => null);
	for (const id of accounts.splice(0)) await root?.removeEntry(directoryFor(id), { recursive: true }).catch(() => {});
});

describe('search runtime with the mail vault', () => {
	it('opens the database with a key from the vault and reopens it after a lock', async () => {
		const a = client();
		a.start();
		const first = await until(a, owner);
		const record = await records.get(accountId);
		expect(record?.bundle.length).toBeGreaterThan(0);
		expect(record?.installationSalt).toHaveLength(32);
		if (first.status?.persistence !== 'persistent') return;
		expect(record?.hasIndex).toBe(true);
		await a.tell('synthetic', { total: 300 });
		await until(a, indexed(300));

		await handleLock({ accountId });
		await a.shutdown();
		const locked = client();
		locked.start();
		await until(locked, (s) => s.phase === 'locked');
		await locked.shutdown();

		await install(9);
		const b = client();
		b.start();
		const reopened = await until(b, owner);
		expect(reopened.status?.sources).toBe(300);
		expect(await matches(b, 'harbour')).toBe(300);
		expect((await records.get(accountId))?.generationId).toBe(record?.generationId);
	}, 90_000);

	it('starts an empty generation when the mail root rotates', async () => {
		const a = client();
		a.start();
		const first = await until(a, owner);
		const before = await records.get(accountId);
		if (first.status?.persistence !== 'persistent') return;
		await a.tell('synthetic', { total: 300 });
		await until(a, indexed(300));
		await a.shutdown();

		await install(4, 2);
		const b = client();
		b.start();
		const rotated = await until(b, owner);
		const after = await records.get(accountId);
		expect(after?.generationId).not.toBe(before?.generationId);
		expect(rotated.status?.sources).toBe(0);
		expect(await matches(b, 'harbour')).toBe(0);
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(directoryFor(accountId));
		expect(dir.kind).toBe('directory');
	}, 90_000);
});
