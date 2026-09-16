import { describe, expect, it } from 'vitest';
import { DirectoryVerificationError } from '../errors';
import type { TlogPolicy } from './policy';
import { exclusiveInTab, type TlogLogState, type TlogStateStore } from './state-idb';
import { verifyTlogProof, type TlogConsistencyProof, type VerifyTlogOptions } from './verify-tlog';
import fixtures from './fixtures/tlog-fixtures.json';
import consistencyFixtures from './fixtures/tlog-consistency-fixtures.json';

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
		},
		exclusive: exclusiveInTab
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
				const details = await run(c, store);
				expect(details.origin).toBe(c.policy.origin);
				expect(details.treeSize).toBeGreaterThan(0);
				expect(details.leafIndex).toBeGreaterThanOrEqual(0);
				expect(details.witnessThreshold).toBe(c.policy.witnessThreshold);
				expect(details.validWitnessCount).toBeGreaterThanOrEqual(c.policy.witnessThreshold);
				const state = await store.get(c.policy.origin);
				expect(state).not.toBeNull();
				expect(state!.treeSize).toBe(details.treeSize);
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

describe('verifyTlogProof witness policy', () => {
	const witnessed = cases.find((c) => c.name === 'ok-witnessed')!;
	const [w1, w2] = witnessed.policy.witnessVerifierKeys!;

	async function codeFor(policy: TlogPolicy) {
		const err = await run({ ...witnessed, policy }, memoryStore()).then(
			() => null,
			(e) => e as unknown
		);
		expect(err).toBeInstanceOf(DirectoryVerificationError);
		return (err as DirectoryVerificationError).code;
	}

	it('accepts the two distinct witnesses that cosigned', async () => {
		const details = await run(
			{ ...witnessed, policy: { ...witnessed.policy, witnessVerifierKeys: [w1, w2] } },
			memoryStore()
		);
		expect(details.validWitnessCount).toBe(2);
	});

	it('rejects a witness key listed twice', async () => {
		expect(
			await codeFor({ ...witnessed.policy, witnessVerifierKeys: [w1, w1], witnessThreshold: 2 })
		).toBe('tlog_policy_invalid');
	});

	it('rejects a threshold above the distinct witness keys', async () => {
		expect(
			await codeFor({ ...witnessed.policy, witnessVerifierKeys: [w1, w2], witnessThreshold: 3 })
		).toBe('tlog_policy_invalid');
	});

	it('rejects a log key configured as a witness', async () => {
		expect(
			await codeFor({
				...witnessed.policy,
				witnessVerifierKeys: [w1, witnessed.policy.logVerifierKey],
				witnessThreshold: 1
			})
		).toBe('tlog_policy_invalid');
	});

	it('rejects an unparseable witness key', async () => {
		expect(
			await codeFor({ ...witnessed.policy, witnessVerifierKeys: [w1, w2, 'garbage'], witnessThreshold: 2 })
		).toBe('tlog_policy_invalid');
	});
});

describe('verifyTlogProof witness freshness', () => {
	const fixture = (name: string) => {
		const c = cases.find((c) => c.name === name);
		if (!c) throw new Error(`missing fixture ${name}`);
		return c;
	};
	const freshTimestamp = nowUnix - 60;
	const maxAge = fixture('ok-witnessed').policy.maxCosignatureAgeSeconds;

	function runAt(c: FixtureCase, seconds: number) {
		return verifyTlogProof(c.tlogProof, new TextEncoder().encode(c.statement), c.address, c.policy, {
			nowMillis: seconds * 1000,
			store: memoryStore()
		});
	}

	async function failureAt(c: FixtureCase, seconds: number) {
		const err = await runAt(c, seconds).then(
			() => null,
			(e) => e as unknown
		);
		expect(err).toBeInstanceOf(DirectoryVerificationError);
		return err as DirectoryVerificationError;
	}

	it('counts only the fresh witnesses when a stale one is attached', async () => {
		const details = await runAt(fixture('ok-fresh-quorum-stale-extra'), nowUnix);
		expect(details.validWitnessCount).toBe(2);
		expect(details.cosignatureTimestamp).toBe(freshTimestamp);
	});

	it('counts only the fresh witnesses when a future-dated one is attached', async () => {
		const details = await runAt(fixture('ok-fresh-quorum-future-extra'), nowUnix);
		expect(details.validWitnessCount).toBe(2);
		expect(details.cosignatureTimestamp).toBe(freshTimestamp);
	});

	it('counts a future-dated witness once it falls inside the skew allowance', async () => {
		const details = await runAt(fixture('ok-fresh-quorum-future-extra'), nowUnix + 3600 - 300);
		expect(details.validWitnessCount).toBe(3);
	});

	it('reports the fresh count when too few witnesses are fresh', async () => {
		const err = await failureAt(fixture('stale-quorum-one-fresh'), nowUnix);
		expect(err.code).toBe('tlog_checkpoint_stale');
		expect(err.details.validWitnessCount).toBe(1);
		expect(err.details.witnessThreshold).toBe(2);
	});

	it('accepts a cosignature exactly at the maximum age', async () => {
		const details = await runAt(fixture('ok-witnessed'), freshTimestamp + maxAge);
		expect(details.validWitnessCount).toBe(2);
	});

	it('rejects a cosignature one second past the maximum age', async () => {
		const err = await failureAt(fixture('ok-witnessed'), freshTimestamp + maxAge + 1);
		expect(err.code).toBe('tlog_checkpoint_stale');
	});

	it('accepts a cosignature exactly at the forward skew allowance', async () => {
		const details = await runAt(fixture('ok-witnessed'), freshTimestamp - 300);
		expect(details.validWitnessCount).toBe(2);
	});

	it('rejects a cosignature one second beyond the forward skew allowance', async () => {
		const err = await failureAt(fixture('ok-witnessed'), freshTimestamp - 301);
		expect(err.code).toBe('tlog_checkpoint_stale');
	});
});

interface ConsistencyCase {
	name: string;
	label: string;
	record: string;
	proof: string;
	previous: { treeSize: number; rootHash: string } | null;
	consistency: TlogConsistencyProof | null;
	expect: string;
	advance: boolean;
}

const chain = consistencyFixtures as unknown as {
	nowUnix: number;
	policy: TlogPolicy;
	cases: ConsistencyCase[];
};

function chainCase(name: string): ConsistencyCase {
	const c = chain.cases.find((c) => c.name === name);
	if (!c) throw new Error(`missing fixture ${name}`);
	return c;
}

function seededStore(c: ConsistencyCase): TlogStateStore {
	return memoryStore(
		c.previous
			? {
					origin: chain.policy.origin,
					treeSize: c.previous.treeSize,
					rootHashB64: c.previous.rootHash,
					updatedAt: 0
				}
			: undefined
	);
}

function runChain(
	c: ConsistencyCase,
	store: TlogStateStore,
	extra: Partial<VerifyTlogOptions> = {}
) {
	return verifyTlogProof(c.proof, new TextEncoder().encode(c.record), c.label, chain.policy, {
		nowMillis: chain.nowUnix * 1000,
		store,
		consistency: c.consistency ?? undefined,
		...extra
	});
}

async function failure(p: Promise<unknown>): Promise<DirectoryVerificationError> {
	const err = await p.then(
		() => null,
		(e) => e as unknown
	);
	expect(err).toBeInstanceOf(DirectoryVerificationError);
	return err as DirectoryVerificationError;
}

function checkpointOf(c: ConsistencyCase): { treeSize: number; rootHash: string } {
	const lines = c.proof.split('\n\n')[1].split('\n');
	return { treeSize: Number(lines[1]), rootHash: lines[2] };
}

describe('verifyTlogProof history continuity', () => {
	for (const c of chain.cases) {
		it(c.name, async () => {
			const store = seededStore(c);
			const before = await store.get(chain.policy.origin);
			if (c.expect === 'ok') {
				const details = await runChain(c, store);
				expect(details.treeSize).toBe(checkpointOf(c).treeSize);
			} else {
				const err = await failure(runChain(c, store));
				expect(err.code).toBe(c.expect);
				if (c.previous) expect(err.details.previousTreeSize).toBe(c.previous.treeSize);
			}
			const after = await store.get(chain.policy.origin);
			if (c.advance) {
				expect(after?.treeSize).toBe(checkpointOf(c).treeSize);
				expect(after?.rootHashB64).toBe(checkpointOf(c).rootHash);
			} else {
				expect(after).toEqual(before);
			}
		});
	}

	it('rejects a conflicting root after accepting the honest one on the same device', async () => {
		const store = memoryStore();
		await runChain(chainCase('first-checkpoint'), store);
		const conflict = chainCase('conflicting-root-same-size');
		const err = await failure(runChain(conflict, store, { consistency: undefined }));
		expect(err.code).toBe('tlog_checkpoint_conflict');
	});

	it('accepts the same checkpoint any number of times', async () => {
		const store = memoryStore();
		const c = chainCase('first-checkpoint');
		for (let i = 0; i < 3; i++) await runChain(c, store);
		expect((await store.get(chain.policy.origin))?.treeSize).toBe(checkpointOf(c).treeSize);
	});

	it('fetches a consistency proof when the lookup carried none', async () => {
		const growth = chainCase('valid-growth');
		const store = seededStore(growth);
		const asked: number[] = [];
		await runChain(growth, store, {
			consistency: undefined,
			refetchConsistency: async (since) => {
				asked.push(since);
				return growth.consistency ?? undefined;
			}
		});
		expect(asked).toEqual([growth.previous!.treeSize]);
		expect((await store.get(chain.policy.origin))?.treeSize).toBe(checkpointOf(growth).treeSize);
	});

	it('does not accept a forged proof from the refetch', async () => {
		const forged = chainCase('growth-forged-proof-hash');
		const err = await failure(
			runChain(forged, seededStore(forged), {
				consistency: undefined,
				refetchConsistency: async () => forged.consistency ?? undefined
			})
		);
		expect(err.code).toBe('tlog_consistency_invalid');
	});

	it('refetches when another verification moved the accepted tree first', async () => {
		const older = chainCase('valid-growth-power-of-two');
		const growth = chainCase('valid-growth');
		const bridge = chainCase('older-consistent-checkpoint');
		const store = seededStore(older);
		const asked: number[] = [];
		const [first, second] = await Promise.all([
			runChain(older, store),
			runChain(growth, store, {
				refetchConsistency: async (since) => {
					asked.push(since);
					return bridge.consistency ?? undefined;
				}
			})
		]);
		expect(first.treeSize).toBe(checkpointOf(older).treeSize);
		expect(second.treeSize).toBe(checkpointOf(growth).treeSize);
		expect(asked).toEqual([checkpointOf(older).treeSize]);
		const state = await store.get(chain.policy.origin);
		expect(state?.rootHashB64).toBe(checkpointOf(growth).rootHash);
	});

	it('serialises concurrent verifications so the accepted tree only moves along one history', async () => {
		const honest = chainCase('growth-from-four');
		const fork = chainCase('late-fork-growth-from-four');
		const store = seededStore(honest);
		const results = await Promise.allSettled([runChain(honest, store), runChain(fork, store)]);
		expect(results[0].status).toBe('fulfilled');
		expect(results[1].status).toBe('rejected');
		const reason = (results[1] as PromiseRejectedResult).reason as DirectoryVerificationError;
		expect(reason.code).toBe('tlog_checkpoint_conflict');
		const state = await store.get(chain.policy.origin);
		expect(state?.rootHashB64).toBe(checkpointOf(honest).rootHash);
	});

	it('treats an unreadable stored root as no prior state', async () => {
		const c = chainCase('first-checkpoint');
		const store = memoryStore({
			origin: chain.policy.origin,
			treeSize: 2,
			rootHashB64: 'not-base64',
			updatedAt: 0
		});
		await runChain(c, store);
		expect((await store.get(chain.policy.origin))?.rootHashB64).toBe(checkpointOf(c).rootHash);
	});
});
