import { afterEach, describe, expect, it } from 'vitest';
import type { VaultRecord } from '$core/keystore/idb';
import type { CustodyJournal } from './journal';
import { advance } from './journal';
import {
	commitCustody,
	forgetAllCustody,
	forgetCustody,
	getAllCustodyVaults,
	getAllJournals,
	getCustodyVault,
	getJournal,
	getStagedVault,
	putJournal,
	putStagedVault
} from './store';

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const OTHER = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';

function journal(accountId: string, migrationId: string): CustodyJournal {
	return {
		accountId,
		schema: 1,
		migrationId,
		state: 'mail-staged',
		target: { kind: 'candidate', digest: 'ZGlnZXN0' },
		exchange: { id: 'server-id', ticket: 't', verifier: 'v', expiresAt: Date.now() + 600_000, step: 'committing', durable: true },
		sessionId: 'child',
		startedAt: 1,
		updatedAt: 1,
		failure: null
	};
}

async function record(accountId: string): Promise<VaultRecord> {
	const localHalfKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'HKDF', false, ['deriveKey']);
	return {
		accountId,
		email: 'calloway@thelemail.test',
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		updatedAt: Date.now(),
		wrappedPrivateKey: crypto.getRandomValues(new Uint8Array(64)),
		wrapIv: crypto.getRandomValues(new Uint8Array(12)),
		wrapPayloadVersion: 4,
		localHalfKey
	};
}

async function stageable(accountId: string, migrationId: string): Promise<{ migrationId: string; accountId: string; record: VaultRecord } | null> {
	try {
		const staged = { migrationId, accountId, record: await record(accountId) };
		await putStagedVault(staged);
		return staged;
	} catch (err) {
		if (err instanceof DOMException && err.name === 'DataCloneError') return null;
		throw err;
	}
}

afterEach(async () => {
	await forgetAllCustody();
});

describe('custody store', () => {
	it('switches the staged vault to active together with the journal', async () => {
		const j = journal(ACCOUNT, 'op-1');
		await putJournal(j);
		const staged = await stageable(ACCOUNT, 'op-1');
		if (!staged) return;
		expect(await getCustodyVault(ACCOUNT)).toBeNull();

		await commitCustody(advance(j, 'mail-committed'), staged.record);

		const active = await getCustodyVault(ACCOUNT);
		expect(active?.wrapPayloadVersion).toBe(4);
		expect(active?.localHalfKey?.extractable).toBe(false);
		expect(Array.from(active!.wrappedPrivateKey!)).toEqual(Array.from(staged.record.wrappedPrivateKey!));
		expect(await getStagedVault('op-1')).toBeNull();
		expect((await getJournal(ACCOUNT))?.state).toBe('mail-committed');
	});

	it('leaves vault, staged record and journal untouched when the commit transaction aborts', async () => {
		const j = journal(ACCOUNT, 'op-2');
		await putJournal(j);
		const staged = await stageable(ACCOUNT, 'op-2');
		if (!staged) return;
		const unclonable = { ...advance(j, 'mail-committed'), failure: (() => {}) as unknown as CustodyJournal['failure'] };

		await expect(commitCustody(unclonable, staged.record)).rejects.toBeDefined();

		expect(await getCustodyVault(ACCOUNT)).toBeNull();
		expect(await getStagedVault('op-2')).not.toBeNull();
		expect((await getJournal(ACCOUNT))?.state).toBe('mail-staged');
	});

	it('commits a memory-only migration with a record that holds no key material', async () => {
		const j = journal(ACCOUNT, 'op-3');
		await putJournal(j);
		await commitCustody(advance(j, 'mail-committed'), { accountId: ACCOUNT, email: 'calloway@thelemail.test', authScheme: 'opaque_v1', armoredEncryptedPrivateKey: '', updatedAt: 1, wrapPayloadVersion: 4 });
		const active = await getCustodyVault(ACCOUNT);
		expect(active?.email).toBe('calloway@thelemail.test');
		expect(active?.wrappedPrivateKey).toBeUndefined();
		expect(active?.localHalfKey).toBeUndefined();
		expect((await getJournal(ACCOUNT))?.state).toBe('mail-committed');
	});

	it('forgets one account without touching another', async () => {
		await putJournal(journal(ACCOUNT, 'op-4'));
		await putJournal(journal(OTHER, 'op-5'));
		const mine = await stageable(ACCOUNT, 'op-4');
		const theirs = await stageable(OTHER, 'op-5');
		if (theirs) await commitCustody(advance(journal(OTHER, 'op-5'), 'mail-committed'), theirs.record);

		await forgetCustody(ACCOUNT);

		expect(await getJournal(ACCOUNT)).toBeNull();
		if (mine) expect(await getStagedVault('op-4')).toBeNull();
		expect((await getAllJournals()).map((x) => x.accountId)).toEqual([OTHER]);
		if (theirs) expect((await getAllCustodyVaults()).map((x) => x.accountId)).toEqual([OTHER]);
	});

	it('stamps the journal schema it writes', async () => {
		await putJournal({ ...journal(ACCOUNT, 'op-6'), schema: 0 });
		expect((await getJournal(ACCOUNT))?.schema).toBe(1);
	});
});
