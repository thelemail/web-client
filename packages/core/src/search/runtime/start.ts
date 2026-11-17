import { keystore } from '$core/keystore/keystore-client';
import { createSearchGeneration, disableSearchSync, enableSearchSync, getSearchSyncState } from '../../api/searchSync';
import { ParserHost } from '../parser/host';
import { watchActivity } from './activity';
import { SearchClient, type ClientDeps } from './client';
import { searchPrefs, searchRecords, type Consent } from './records';
import { serveBridge } from '../sync/serve';

function broker(): MessagePort | null {
	if (typeof SharedWorker === 'undefined') return null;
	try {
		return new SharedWorker(new URL('./broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port;
	} catch {
		return null;
	}
}

let parserHost: ParserHost | null = null;

function parser(): MessagePort | null {
	const origin = import.meta.env.PUBLIC_PARSER_ORIGIN;
	if (!origin || typeof document === 'undefined') return null;
	parserHost ??= new ParserHost({ origin });
	return parserHost.connect();
}

const deps: ClientDeps = {
	spawn: () => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search' }),
	broker,
	openRoot: (args, port) => keystore.openSearchRoot(args, port),
	records: searchRecords,
	prefs: searchPrefs,
	locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
	watch: watchActivity,
	serveBridge,
	parser,
	cloud: { state: getSearchSyncState, create: createSearchGeneration, enable: enableSearchSync, disable: disableSearchSync }
};

export function startSearch(accountId: string, consent: Consent): SearchClient {
	const client = new SearchClient(accountId, deps, consent === 'saved' ? 'saved' : 'preview');
	client.start();
	return client;
}

export function wipeSearch(accountId: string): Promise<void> {
	return new SearchClient(accountId, deps).shutdown({ wipe: true });
}
