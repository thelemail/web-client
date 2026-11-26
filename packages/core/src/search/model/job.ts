/// <reference path="./virtual.d.ts" />
import manifest from 'virtual:model-assets';
import type { JobFactory } from '../runtime/host';
import { Coverage } from '../sqlite/types';
import { semanticEpoch } from './epoch';
import { modelId } from './store';
import { VECTOR_BYTES } from './pool';

export const UNAVAILABLE_RETRY_MS = 7 * 24 * 60 * 60_000;
export const MODEL_ID = modelId(manifest.hash);
const PICK = 8;
const RECORD_BYTES = VECTOR_BYTES + 32;
const EMBEDDABLE: readonly Coverage[] = [Coverage.complete, Coverage.partial];

export const embeddingsJob: JobFactory = (ctx) => {
	let epoch: number | null = null;
	return {
		name: 'embeddings',
		class: 'embeddings',
		receive(message) {
			if (message === 'retry') {
				ctx.passages?.setUnavailable(null);
				ctx.passages?.retryFailed();
				ctx.wake('embeddings');
			}
		},
		async step(step) {
			const link = ctx.model;
			const store = ctx.passages;
			if (!link || !store) return 'idle';
			const since = store.unavailableSince();
			if (since !== null && ctx.now() - since < UNAVAILABLE_RETRY_MS) {
				if (link.state.state !== 'unavailable') link.unavailable('memory');
				return 'idle';
			}
			epoch ??= await semanticEpoch(manifest.hash);
			store.adopt(epoch, MODEL_ID);
			store.seed();
			while (!step.shouldYield()) {
				const batch = store.pending(PICK);
				if (batch.length === 0) {
					store.promote();
					link.idleSoon();
					return 'idle';
				}
				for (const s of batch) {
					if (!EMBEDDABLE.includes(s.body)) store.mark(s.id, s.contentRev, s.body);
				}
				const todo = batch.filter((s) => EMBEDDABLE.includes(s.body));
				if (todo.length === 0) continue;
				const acquired = await link.acquire();
				if (!acquired.ok) {
					if ('unavailable' in acquired) {
						if (acquired.unavailable === 'memory' || acquired.unavailable === 'wasm') store.setUnavailable(ctx.now());
						return 'idle';
					}
					ctx.later('embeddings', acquired.retryMs);
					return 'idle';
				}
				for (const s of todo) {
					if (step.shouldYield()) return 'more';
					const fence = link.fence;
					const embedded = await link.embed(store.input(s.id), step.signal);
					if (!embedded.ok) {
						switch (embedded.reason) {
							case 'tooMany':
							case 'tooLong':
								store.mark(s.id, s.contentRev, Coverage.resourceLimited);
								continue;
							case 'invalid':
								store.mark(s.id, s.contentRev, Coverage.failed);
								continue;
							case 'cancelled':
								return 'more';
							case 'memory':
							case 'wasm':
								store.setUnavailable(ctx.now());
								return 'idle';
							default:
								return 'more';
						}
					}
					if (!(await link.check(fence))) return 'more';
					const admitted = await ctx.admit(embedded.passages.length * RECORD_BYTES);
					if (!admitted.ok) return 'blocked';
					store.put(s.id, s.contentRev, epoch, embedded.passages);
				}
			}
			return 'more';
		}
	};
};
