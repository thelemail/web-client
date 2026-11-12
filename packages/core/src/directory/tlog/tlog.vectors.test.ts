import { describe, expect, it } from 'vitest';
import { DirectoryVerificationError } from '../errors';
import type { TlogPolicy } from './policy';
import { exclusiveInTab, type TlogLogState, type TlogStateStore } from './state-idb';
import { verifyTlogProof } from './verify-tlog';
import vectors from '../../interop/vectors/tlog.json';

const policy = vectors.policy as TlogPolicy;

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

describe('transparency log proofs agree with trust', () => {
	for (const c of vectors.cases) {
		it(`${c.name} -> ${c.expect}`, async () => {
			const store = memoryStore(
				c.previous
					? { origin: policy.origin, treeSize: c.previous.treeSize, rootHashB64: c.previous.rootHash, updatedAt: 0 }
					: undefined
			);
			const before = await store.get(policy.origin);
			const run = verifyTlogProof(c.tlogProof, new TextEncoder().encode(c.statement), c.address, policy, {
				nowMillis: vectors.nowUnix * 1000,
				store,
				consistency: c.consistency ?? undefined
			});
			if (c.expect === 'ok') {
				const details = await run;
				expect(details.treeSize).toBe(c.treeSize);
				expect(details.leafIndex).toBe(c.leafIndex);
				expect(details.validWitnessCount).toBe(c.validWitnessCount);
			} else {
				const err = await run.then(
					() => null,
					(e: unknown) => e
				);
				expect(err).toBeInstanceOf(DirectoryVerificationError);
				expect((err as DirectoryVerificationError).code).toBe(c.expect);
			}
			const after = await store.get(policy.origin);
			if (c.stateAdvance) {
				expect(after?.treeSize).toBe(c.treeSize);
			} else {
				expect(after).toEqual(before);
			}
		});
	}
});
