/// <reference lib="webworker" />
import { embeddingsJob } from '../model/job';
import { document } from '../sqlite/harness';
import { serve, type JobFactory } from './host';

const mail: JobFactory = (ctx) => {
	let total = 0;
	let texts: string[] | null = null;
	return {
		name: 'mail',
		class: 'body',
		receive(message) {
			({ total, texts = null } = message as { total: number; texts?: string[] });
			ctx.wake('mail');
		},
		async step(step) {
			const batch = ctx.batch('mail');
			let next = Number(batch.resume() ?? 0);
			if (next >= total) return 'idle';
			while (next < total && !step.shouldYield()) {
				const id = next++;
				const text = texts ? texts[id] : id % 2 ? `The ferry to the island leaves at nine. Ticket ${id}.` : `Invoice ${id} for the office chairs is overdue.`;
				if (batch.add(document(`m${id}`, { subject: `Message ${id}`, parts: [{ field: 3, text }] }), String(next))) break;
			}
			const committed = await batch.commit();
			if (!committed.ok) return 'blocked';
			ctx.wake('embeddings');
			return next < total ? 'more' : 'idle';
		}
	};
};

serve(self as unknown as DedicatedWorkerGlobalScope, [mail, embeddingsJob]);
