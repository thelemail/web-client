/// <reference lib="webworker" />
import { parse } from '$core/search/extract/parse';
import { setPdfAssets } from '$core/search/extract/files/index';
import type { FromWorker, ToWorker } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const TICK_MS = 250;

function send(message: FromWorker): void {
	scope.postMessage(message);
}

scope.addEventListener('message', async (e: MessageEvent<ToWorker>) => {
	const m = e.data;
	if (m?.type === 'init') {
		setPdfAssets(new Map(m.assets));
		return;
	}
	if (m?.type !== 'job') return;
	let last = 0;
	const tick = () => {
		const now = Date.now();
		if (now - last < TICK_MS) return;
		last = now;
		send({ type: 'tick', id: m.id });
	};
	try {
		send({ type: 'done', id: m.id, result: await parse(m.request, tick) });
	} catch {
		send({ type: 'error', id: m.id });
	}
});
