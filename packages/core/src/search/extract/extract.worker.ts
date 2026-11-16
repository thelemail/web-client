/// <reference lib="webworker" />
import { extract, type ExtractRequest } from './extract';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<{ id: number; request: ExtractRequest }>) => {
	const { id, request } = e.data;
	try {
		scope.postMessage({ id, ok: true, value: await extract(request) });
	} catch {
		scope.postMessage({ id, ok: false });
	}
};
