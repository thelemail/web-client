import { describe, expect, it } from 'vitest';
import { Scheduler, type Job, type JobClass, type StepContext, type StepOutcome } from './scheduler';

const ALLOWED = { visible: true, idle: true, constrained: false };

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await tick();
}

function job(name: string, cls: JobClass, step: (ctx: StepContext) => Promise<StepOutcome> | StepOutcome): Job {
	return { name, class: cls, step: async (ctx) => step(ctx) };
}

function counted(name: string, cls: JobClass, steps: number, log: string[]): Job {
	let left = steps;
	return job(name, cls, () => {
		log.push(name);
		return --left > 0 ? 'more' : 'idle';
	});
}

describe('Scheduler', () => {
	it('runs nothing until the page is visible and idle', async () => {
		const log: string[] = [];
		const s = new Scheduler({ yieldTask: tick });
		s.register(counted('body', 'body', 2, log));
		await settle();
		expect(log).toEqual([]);
		s.setConditions({ visible: true, idle: false, constrained: false });
		await settle();
		expect(log).toEqual([]);
		s.setConditions(ALLOWED);
		await settle();
		expect(log).toEqual(['body', 'body']);
	});

	it('stops on a constrained device', async () => {
		const log: string[] = [];
		const s = new Scheduler({ yieldTask: tick });
		s.setConditions({ visible: true, idle: true, constrained: true });
		s.register(counted('body', 'body', 1, log));
		await settle();
		expect(log).toEqual([]);
	});

	it('finishes a higher class before a lower one', async () => {
		const log: string[] = [];
		const s = new Scheduler({ yieldTask: tick });
		s.register(counted('maintenance', 'maintenance', 2, log));
		s.register(counted('embeddings', 'embeddings', 2, log));
		s.register(counted('metadata', 'metadata', 2, log));
		s.register(counted('body', 'body', 2, log));
		s.setConditions(ALLOWED);
		await settle();
		expect(log).toEqual(['metadata', 'metadata', 'body', 'body', 'embeddings', 'embeddings', 'maintenance', 'maintenance']);
	});

	it('runs one job at a time', async () => {
		let active = 0;
		let peak = 0;
		const s = new Scheduler({ yieldTask: tick });
		const slow = (name: string, cls: JobClass) => {
			let left = 3;
			return job(name, cls, async () => {
				active++;
				peak = Math.max(peak, active);
				await tick();
				active--;
				return --left > 0 ? 'more' : 'idle';
			});
		};
		s.register(slow('body', 'body'));
		s.register(slow('attachments', 'attachments'));
		s.setConditions(ALLOWED);
		await settle();
		expect(peak).toBe(1);
	});

	it('asks a running step to yield while a query is in the foreground', async () => {
		const seen: boolean[] = [];
		const gate = Promise.withResolvers<void>();
		const query = Promise.withResolvers<void>();
		const s = new Scheduler({ yieldTask: tick });
		let ran = 0;
		s.register(
			job('body', 'body', async (ctx) => {
				ran++;
				seen.push(ctx.shouldYield());
				await gate.promise;
				seen.push(ctx.shouldYield());
				return 'more';
			})
		);
		s.setConditions(ALLOWED);
		await settle();
		const pending = s.foreground(() => query.promise);
		gate.resolve();
		await settle();
		expect(seen).toEqual([false, true]);
		expect(ran).toBe(1);
		query.resolve();
		await pending;
		await settle();
		expect(ran).toBeGreaterThan(1);
		await s.stop();
	});

	it('asks a lower class to yield when a higher class wakes', async () => {
		const gate = Promise.withResolvers<void>();
		const log: string[] = [];
		let yielded = false;
		const s = new Scheduler({ yieldTask: tick });
		s.register(
			job('maintenance', 'maintenance', async (ctx) => {
				log.push('maintenance');
				await gate.promise;
				yielded = ctx.shouldYield();
				return 'idle';
			})
		);
		s.setConditions(ALLOWED);
		await settle();
		s.register(counted('metadata', 'metadata', 1, log));
		gate.resolve();
		await settle();
		expect(yielded).toBe(true);
		expect(log).toEqual(['maintenance', 'metadata']);
	});

	it('keeps a blocked job parked until it is woken', async () => {
		const log: string[] = [];
		let outcome: StepOutcome = 'blocked';
		const s = new Scheduler({ yieldTask: tick });
		s.register(
			job('body', 'body', () => {
				log.push('body');
				return outcome;
			})
		);
		s.setConditions(ALLOWED);
		await settle();
		expect(log).toEqual(['body']);
		expect(s.blocked).toBe(true);
		outcome = 'idle';
		s.wake('body');
		await settle();
		expect(log).toEqual(['body', 'body']);
		expect(s.blocked).toBe(false);
	});

	it('reports a failing job and moves on', async () => {
		const failed: string[] = [];
		const log: string[] = [];
		const s = new Scheduler({ yieldTask: tick, onError: (j) => failed.push(j.name) });
		s.register(
			job('metadata', 'metadata', () => {
				throw new Error('boom');
			})
		);
		s.register(counted('body', 'body', 1, log));
		s.setConditions(ALLOWED);
		await settle();
		expect(failed).toEqual(['metadata']);
		expect(log).toEqual(['body']);
	});

	it('aborts the running step on stop and runs nothing after', async () => {
		const gate = Promise.withResolvers<void>();
		let aborted = false;
		let ran = 0;
		const s = new Scheduler({ yieldTask: tick });
		s.register(
			job('body', 'body', async (ctx) => {
				ran++;
				ctx.signal.addEventListener('abort', () => {
					aborted = true;
					gate.resolve();
				});
				await gate.promise;
				return 'more';
			})
		);
		s.setConditions(ALLOWED);
		await settle();
		await s.stop();
		await settle();
		expect(aborted).toBe(true);
		expect(ran).toBe(1);
		expect(s.working).toBeNull();
	});
});
