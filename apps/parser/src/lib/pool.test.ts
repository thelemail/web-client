import { describe, expect, it } from 'vitest';
import type { FromWorker, ToWorker } from './messages';
import { Pool } from './pool';

type Behaviour = 'done' | 'hang' | 'tick-then-done' | 'crash' | 'error';

class FakeWorker extends EventTarget {
	static spawned = 0;
	terminated = false;
	received: ToWorker[] = [];
	behaviour: Behaviour;

	constructor(behaviour: Behaviour) {
		super();
		this.behaviour = behaviour;
		FakeWorker.spawned++;
	}

	#send(message: FromWorker): void {
		if (!this.terminated) this.dispatchEvent(new MessageEvent('message', { data: message }));
	}

	postMessage(message: ToWorker): void {
		this.received.push(message);
		if (message.type !== 'job') return;
		const { id } = message;
		const done = () => this.#send({ type: 'done', id, result: { kind: 'file', value: { state: 'complete', parts: [], warnings: 0 } } });
		if (this.behaviour === 'done') setTimeout(done, 5);
		else if (this.behaviour === 'tick-then-done') {
			let n = 0;
			const timer = setInterval(() => {
				this.#send({ type: 'tick', id });
				if (++n === 5) {
					clearInterval(timer);
					done();
				}
			}, 20);
		} else if (this.behaviour === 'crash') setTimeout(() => this.dispatchEvent(new Event('error')), 5);
		else if (this.behaviour === 'error') setTimeout(() => this.#send({ type: 'error', id }), 5);
	}

	terminate(): void {
		this.terminated = true;
	}
}

function pool(behaviour: Behaviour, sliceMs = 50) {
	const workers: FakeWorker[] = [];
	const p = new Pool({
		spawn: () => {
			const w = new FakeWorker(behaviour);
			workers.push(w);
			return w as unknown as Worker;
		},
		assets: new Map([['cmaps/a.bcmap', new Uint8Array([1, 2])]]),
		size: 1,
		sliceMs,
		jobMs: 2000
	});
	return { p, workers };
}

const request = () => ({ kind: 'mime' as const, bytes: new Uint8Array(4) });

describe('parser pool', () => {
	it('sends verified assets before the first job', async () => {
		const { p, workers } = pool('done');
		expect(await p.run(request())).toMatchObject({ ok: true });
		expect(workers[0].received.map((m) => m.type)).toEqual(['init', 'job']);
	});

	it('kills a worker that stops reporting progress', async () => {
		const { p, workers } = pool('hang');
		expect(await p.run(request())).toEqual({ ok: false, reason: 'timeout' });
		expect(workers[0].terminated).toBe(true);
	});

	it('keeps a worker alive while it reports progress', async () => {
		const { p, workers } = pool('tick-then-done', 50);
		expect(await p.run(request())).toMatchObject({ ok: true });
		expect(workers[0].terminated).toBe(false);
	});

	it('replaces a worker after a crash or an error', async () => {
		const crash = pool('crash');
		expect(await crash.p.run(request())).toEqual({ ok: false, reason: 'crashed' });
		expect(crash.workers[0].terminated).toBe(true);
		const error = pool('error');
		expect(await error.p.run(request())).toEqual({ ok: false, reason: 'crashed' });
		await error.p.run(request());
		expect(error.workers).toHaveLength(2);
	});

	it('runs jobs one at a time on a single slot and recycles after a batch', async () => {
		const { p, workers } = pool('done');
		const results = await Promise.all(Array.from({ length: 25 }, () => p.run(request())));
		expect(results.every((r) => r.ok)).toBe(true);
		expect(workers).toHaveLength(2);
		expect(workers[0].terminated).toBe(true);
	});

	it('fails queued work on close', async () => {
		const { p } = pool('hang', 10_000);
		const first = p.run(request());
		const second = p.run(request());
		p.close();
		expect(await first).toEqual({ ok: false, reason: 'unavailable' });
		expect(await second).toEqual({ ok: false, reason: 'unavailable' });
		expect(await p.run(request())).toEqual({ ok: false, reason: 'unavailable' });
	});
});
