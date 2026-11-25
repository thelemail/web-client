import type { SearchSessionCommand, SearchSessionRequest, SearchSessionResponse } from '../../keystore/protocol';

export const KEY_TIMEOUT_MS = 10_000;

export function sessionCall<T>(port: MessagePort, cmd: SearchSessionCommand, args?: unknown): Promise<T | null> {
	return new Promise((resolve) => {
		const id = crypto.randomUUID();
		const finish = (value: T | null) => {
			clearTimeout(timer);
			port.removeEventListener('message', listener);
			resolve(value);
		};
		const listener = (e: MessageEvent<SearchSessionResponse>) => {
			if (e.data?.type === 'response' && e.data.id === id) finish(e.data.value as T);
		};
		const timer = setTimeout(() => finish(null), KEY_TIMEOUT_MS);
		port.addEventListener('message', listener);
		port.start();
		port.postMessage({ id, cmd, args } satisfies SearchSessionRequest);
	});
}
