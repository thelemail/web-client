import { keystore } from '$core/keystore/keystore-client';
import { watchActivity } from './activity';
import { SearchClient, type ClientDeps } from './client';
import { searchRecords } from './records';

function broker(): MessagePort | null {
	if (typeof SharedWorker === 'undefined') return null;
	try {
		return new SharedWorker(new URL('./broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port;
	} catch {
		return null;
	}
}

const deps: ClientDeps = {
	spawn: () => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search' }),
	broker,
	openRoot: (args, port) => keystore.openSearchRoot(args, port),
	records: searchRecords,
	locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
	watch: watchActivity
};

export function startSearch(accountId: string): SearchClient {
	const client = new SearchClient(accountId, deps);
	client.start();
	return client;
}

export function wipeSearch(accountId: string): Promise<void> {
	return new SearchClient(accountId, deps).shutdown({ wipe: true });
}
