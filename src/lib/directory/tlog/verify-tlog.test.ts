import { describe, expect, it } from 'vitest';
import { DirectoryVerificationError } from '../errors';
import type { TlogPolicy } from './policy';
import type { TlogLogState, TlogStateStore } from './state-idb';
import { verifyTlogProof } from './verify-tlog';
import fixtures from './fixtures/tlog-fixtures.json';

interface FixtureCase {
	name: string;
	address: string;
	statement: string;
	tlogProof: string;
	policy: TlogPolicy;
	expect: string;
}

const { nowUnix, cases } = fixtures as unknown as { nowUnix: number; cases: FixtureCase[] };

function memoryStore(seed?: TlogLogState): TlogStateStore {
	const states = new Map<string, TlogLogState>();
	if (seed) states.set(seed.origin, seed);
	return {
		async get(origin) {
			return states.get(origin) ?? null;
		},
		async put(state) {
			states.set(state.origin, state);
		}
	};
}

function run(c: FixtureCase, store: TlogStateStore) {
	return verifyTlogProof(c.tlogProof, new TextEncoder().encode(c.statement), c.address, c.policy, {
		nowMillis: nowUnix * 1000,
		store
	});
}

describe('verifyTlogProof fixtures', () => {
	for (const c of cases) {
		it(c.name, async () => {
			const store = memoryStore();
			if (c.expect === 'ok') {
				await expect(run(c, store)).resolves.toBeUndefined();
				const state = await store.get(c.policy.origin);
				expect(state).not.toBeNull();
				expect(state!.treeSize).toBeGreaterThan(0);
			} else {
				const err = await run(c, store).then(
					() => null,
					(e) => e as unknown
				);
				expect(err).toBeInstanceOf(DirectoryVerificationError);
				expect((err as DirectoryVerificationError).code).toBe(c.expect);
			}
		});
	}
});

describe('verifyTlogProof monotonicity', () => {
	const okDev = cases.find((c) => c.name === 'ok-dev')!;

	it('accepts repeated verification at the same tree size', async () => {
		const store = memoryStore();
		await run(okDev, store);
		await expect(run(okDev, store)).resolves.toBeUndefined();
	});

	it('rejects a checkpoint smaller than the stored tree size', async () => {
		const store = memoryStore({
			origin: okDev.policy.origin,
			treeSize: 100,
			rootHashB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			updatedAt: nowUnix * 1000
		});
		const err = await run(okDev, store).then(
			() => null,
			(e) => e as DirectoryVerificationError
		);
		expect(err).toBeInstanceOf(DirectoryVerificationError);
		expect(err!.code).toBe('tlog_tree_rolled_back');
		expect(err!.details.previousTreeSize).toBe(100);
	});

	it('advances the stored tree size on success', async () => {
		const store = memoryStore({
			origin: okDev.policy.origin,
			treeSize: 2,
			rootHashB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			updatedAt: 0
		});
		await run(okDev, store);
		const state = await store.get(okDev.policy.origin);
		expect(state!.treeSize).toBe(3);
	});
});
