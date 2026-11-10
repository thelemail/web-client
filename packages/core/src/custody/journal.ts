export const CUSTODY_STATES = ['prepared', 'mail-staged', 'mail-committed', 'legacy-retired-local', 'auth-ready', 'complete'] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];

export const JOURNAL_SCHEMA = 1;

export type ExchangeStep = 'reserved' | 'installed' | 'staged' | 'committing';

export interface CustodyTarget {
	kind: 'candidate' | 'committed';
	digest: string;
}

export interface CustodyExchange {
	id: string;
	ticket: string;
	verifier: string;
	expiresAt: number;
	step: ExchangeStep;
	durable: boolean;
}

export interface CustodyJournal {
	accountId: string;
	schema: number;
	migrationId: string;
	state: CustodyState;
	target: CustodyTarget;
	exchange: CustodyExchange | null;
	sessionId: string | null;
	startedAt: number;
	updatedAt: number;
	failure: { code: string; state: CustodyState; at: number } | null;
}

export function custodyRank(state: CustodyState): number {
	return CUSTODY_STATES.indexOf(state);
}

export function reached(journal: Pick<CustodyJournal, 'state'> | null, state: CustodyState): boolean {
	return journal !== null && custodyRank(journal.state) >= custodyRank(state);
}

export function isProductCustody(journal: Pick<CustodyJournal, 'state'> | null): boolean {
	return reached(journal, 'mail-committed');
}

export function isSettled(journal: Pick<CustodyJournal, 'state'> | null): boolean {
	return reached(journal, 'auth-ready');
}

export function readable(journal: Pick<CustodyJournal, 'schema'> | null): boolean {
	return journal === null || journal.schema <= JOURNAL_SCHEMA;
}

export function advance(journal: CustodyJournal, state: CustodyState, now = Date.now()): CustodyJournal {
	const from = custodyRank(journal.state);
	const to = custodyRank(state);
	if (to !== from + 1) throw new Error(`custody: cannot move from ${journal.state} to ${state}`);
	return { ...journal, state, updatedAt: now, failure: null };
}

export function rewind(journal: CustodyJournal, migrationId: string, target: CustodyTarget, now = Date.now()): CustodyJournal {
	if (isProductCustody(journal)) throw new Error('custody: a committed migration cannot restart');
	return { ...journal, migrationId, target, state: 'prepared', exchange: null, sessionId: null, updatedAt: now, failure: null };
}

export function exchangeExpired(exchange: CustodyExchange | null, now = Date.now()): boolean {
	return exchange !== null && exchange.step !== 'committing' && exchange.expiresAt <= now;
}
