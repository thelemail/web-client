/// <reference lib="webworker" />
import { document } from '../sqlite/harness';
import { maintenanceJob, serve, type JobFactory } from './host';

export interface SyntheticOrder {
	total?: number;
	storage?: { quota: number; usage: number };
}

const synthetic: JobFactory = (ctx) => {
	let total = 0;
	return {
		name: 'synthetic',
		class: 'body',
		receive(message) {
			const order = message as SyntheticOrder;
			if (order.storage) {
				const estimate = order.storage;
				Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => estimate });
			}
			if (order.total !== undefined) total = order.total;
			ctx.wake('synthetic');
		},
		async step(step) {
			const batch = ctx.batch('synthetic');
			let next = Number(batch.resume() ?? 0);
			if (next >= total) return 'idle';
			while (next < total && !step.shouldYield()) {
				const id = next++;
				if (batch.add(document(`s${id}`, { subject: `Synthetic ${id}`, parts: [{ field: 3, text: `harbour ledger ${id}` }] }), String(next))) break;
			}
			const committed = await batch.commit();
			if (!committed.ok) return 'blocked';
			return next < total ? 'more' : 'idle';
		}
	};
};

serve(self as unknown as DedicatedWorkerGlobalScope, [synthetic, maintenanceJob]);
