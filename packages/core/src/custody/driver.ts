import type { AliasKeyGrant } from '$core/api/aliases';
import type { CryptoStateResponse, ProductCandidateResponse, ProductKeysResponse } from '$core/api/productKeys';
import type { AccountKeyListResponse, RefreshResponse } from '$core/api/types';
import { ApiCallError } from '$core/api/types';
import { conversionArgs } from '$core/auth/product-keys';
import { b64url, challengeS256 } from '$core/keystore/handoff/wire';
import { parseCandidate } from '$core/keystore/productkeys/candidate';
import { b64decode, b64encode } from '$core/keystore/productkeys/encoding';
import { parseIdentityManifest } from '$core/keystore/productkeys/manifests';
import type { StoredBundle } from '$core/keystore/productkeys/read';
import type {
	CustodyAdoptArgs,
	CustodyAdoptResponse,
	CustodyCommitArgs,
	CustodyCommitResponse,
	CustodyPrepareArgs,
	CustodyPrepareResponse,
	CustodyRefusal,
	CustodyRetireArgs,
	CustodyRetireResponse,
	CustodyScopedArgs,
	CustodyStageArgs,
	CustodyStageResponse,
	StatusResponse
} from '$core/keystore/protocol';
import type { CommittedExchange, InstalledExchange, PreparedExchange } from './api';
import type { CustodyJournal, CustodyTarget } from './journal';
import { advance, exchangeExpired, isProductCustody, isSettled, JOURNAL_SCHEMA, readable, rewind } from './journal';

export type CustodySkip = 'not-enrolled' | 'disabled' | 'locked' | 'unsupported' | 'busy' | 'host-session' | 'newer-build';

export type CustodyOutcome =
	| { status: 'done' }
	| { status: 'skipped'; reason: CustodySkip }
	| { status: 'blocked'; reason: string }
	| { status: 'retry'; reason: string };

export interface CustodySessionGrant {
	accessToken: string;
	expiresIn: number;
	csrfToken?: string;
}

export interface CustodyDeps {
	now(): number;
	uuid(): string;
	randomBytes(n: number): Uint8Array;
	lock<T>(accountId: string, run: () => Promise<T>): Promise<T | null>;
	journal: {
		get(accountId: string): Promise<CustodyJournal | null>;
		put(journal: CustodyJournal): Promise<void>;
	};
	keystore: {
		status(): Promise<StatusResponse>;
		custodyPrepare(args: CustodyPrepareArgs): Promise<CustodyPrepareResponse>;
		custodyAdopt(args: CustodyAdoptArgs): Promise<CustodyAdoptResponse>;
		custodyStage(args: CustodyStageArgs): Promise<CustodyStageResponse>;
		custodyCommit(args: CustodyCommitArgs): Promise<CustodyCommitResponse>;
		custodyRetire(args: CustodyRetireArgs): Promise<CustodyRetireResponse>;
		custodyDiscard(args: CustodyScopedArgs): Promise<void>;
	};
	server: {
		cryptoState(accountId: string): Promise<{ state: CryptoStateResponse; events: Uint8Array[] }>;
		accountKeys(accountId: string): Promise<AccountKeyListResponse>;
		aliasGrants(accountId: string): Promise<AliasKeyGrant[]>;
		productKeys(accountId: string): Promise<ProductKeysResponse>;
		productBundle(accountId: string, bundleId: string, revision: number): Promise<string>;
		rootDescriptor(accountId: string): Promise<{ bundleId: string; bundleRevision: number; bundle: string }>;
		candidate(accountId: string): Promise<ProductCandidateResponse | null>;
		putCandidateBundle(accountId: string, bundleId: string, revision: number, bundle: string): Promise<void>;
		claimCandidate(accountId: string, body: { rootBundleId: string; rootBundleRevision: number; rootBundle: string; record: string }): Promise<ProductCandidateResponse>;
		prepare(accountId: string, body: { operationId: string; codeChallenge: string; targetDigest: string }): Promise<PreparedExchange>;
		bootstrap(): Promise<{ csrfToken: string }>;
		install(migrationId: string, csrf: string, body: { ticket: string; verifier: string }): Promise<InstalledExchange>;
		commit(migrationId: string, token: string, body: { targetDigest: string }): Promise<CommittedExchange>;
		hostRefresh(accountId: string): Promise<RefreshResponse | null>;
	};
	session: {
		enrolled(accountId: string): boolean;
		hostBound(accountId: string): boolean;
		adopt(accountId: string, grant: CustodySessionGrant): Promise<void>;
		reopen(accountId: string): Promise<void>;
		announce(accountId: string): void;
	};
}

const DONE: CustodyOutcome = { status: 'done' };

function skipped(reason: CustodySkip): CustodyOutcome {
	return { status: 'skipped', reason };
}

function refusal(r: CustodyRefusal): CustodyOutcome {
	if (r.code === 'locked') return skipped('locked');
	if (r.code === 'unsupported') return skipped('unsupported');
	if (r.code === 'missing') return { status: 'retry', reason: 'worker-restarted' };
	return { status: 'blocked', reason: r.message ?? 'invalid' };
}

function apiStatus(err: unknown): number | null {
	return err instanceof ApiCallError ? err.status : null;
}

function apiCode(err: unknown): string | null {
	return err instanceof ApiCallError ? (err.envelope?.error?.code ?? null) : null;
}

type Adopted = { target: CustodyTarget } | { outcome: CustodyOutcome };

async function bundlesOf(accountId: string, refs: { bundleId: string; revision: number }[], deps: CustodyDeps): Promise<StoredBundle[]> {
	const out: StoredBundle[] = [];
	for (const ref of refs) {
		out.push({ bundleId: ref.bundleId, revision: ref.revision, bundle: b64decode(await deps.server.productBundle(accountId, ref.bundleId, ref.revision)) });
	}
	return out;
}

async function adoptCommitted(accountId: string, migrationId: string, deps: CustodyDeps): Promise<Adopted> {
	const view = await deps.server.productKeys(accountId);
	if (!view.head || view.head.version !== 2 || !view.identityManifest) return { outcome: { status: 'retry', reason: 'head-not-ready' } };
	const record = b64decode(view.identityManifest.record);
	const root = await deps.server.rootDescriptor(accountId);
	const res = await deps.keystore.custodyAdopt({
		accountId,
		migrationId,
		source: {
			kind: 'committed',
			stored: {
				head: { raw: b64decode(view.head.head), mac: b64decode(view.head.mac) },
				rootBundle: { bundleId: root.bundleId, revision: root.bundleRevision, bundle: b64decode(root.bundle) },
				identityManifest: record,
				bundles: await bundlesOf(accountId, parseIdentityManifest(record).bundles, deps)
			}
		}
	});
	if (!res.ok) return { outcome: refusal(res) };
	return { target: { kind: 'committed', digest: b64encode(res.digest) } };
}

async function adoptCandidate(accountId: string, migrationId: string, loaded: { state: CryptoStateResponse; events: Uint8Array[] }, deps: CustodyDeps): Promise<Adopted> {
	let found = await deps.server.candidate(accountId);
	if (!found) {
		const [keys, aliases] = await Promise.all([deps.server.accountKeys(accountId), deps.server.aliasGrants(accountId)]);
		const args = conversionArgs(accountId, loaded.state, loaded.events, keys, aliases);
		const built = await deps.keystore.custodyPrepare({
			accountId,
			migrationId,
			amkEpoch: loaded.state.scope.amkEpoch,
			historyEvents: args.historyEvents,
			availability: args.availability,
			accountKeys: args.accountKeys,
			aliasKeys: args.aliasKeys
		});
		if (!built.ok) return { outcome: refusal(built) };
		for (const b of built.upload.bundles) await deps.server.putCandidateBundle(accountId, b.bundleId, b.revision, b64encode(b.bundle));
		try {
			found = await deps.server.claimCandidate(accountId, {
				rootBundleId: built.upload.rootBundleId,
				rootBundleRevision: built.upload.rootBundleRevision,
				rootBundle: b64encode(built.upload.rootBundle),
				record: b64encode(built.upload.record)
			});
		} catch (err) {
			if (apiCode(err) === 'product_keys_committed') return adoptCommitted(accountId, migrationId, deps);
			throw err;
		}
	}
	const record = b64decode(found.record);
	const res = await deps.keystore.custodyAdopt({
		accountId,
		migrationId,
		source: { kind: 'candidate', stored: { record, rootBundle: b64decode(found.rootBundle), bundles: await bundlesOf(accountId, parseCandidate(record).bundles, deps) } }
	});
	if (!res.ok) return { outcome: refusal(res) };
	return { target: { kind: 'candidate', digest: b64encode(res.digest) } };
}

function adopt(accountId: string, migrationId: string, loaded: { state: CryptoStateResponse; events: Uint8Array[] }, deps: CustodyDeps): Promise<Adopted> {
	return loaded.state.head?.version === 2 ? adoptCommitted(accountId, migrationId, deps) : adoptCandidate(accountId, migrationId, loaded, deps);
}

async function restart(journal: CustodyJournal, target: CustodyTarget, deps: CustodyDeps): Promise<CustodyJournal> {
	await deps.keystore.custodyDiscard({ accountId: journal.accountId, migrationId: journal.migrationId });
	const next = rewind(journal, deps.uuid(), target, deps.now());
	await deps.journal.put(next);
	return next;
}

async function settle(journal: CustodyJournal, deps: CustodyDeps): Promise<CustodyOutcome> {
	let j = journal;
	const accountId = j.accountId;
	if (j.state === 'mail-committed') {
		if (!deps.session.hostBound(accountId)) {
			const grant = await deps.server.hostRefresh(accountId);
			if (!grant) return { status: 'blocked', reason: 'mail-session-missing' };
			await deps.session.adopt(accountId, { accessToken: grant.accessToken, expiresIn: grant.expiresInSeconds, csrfToken: grant.csrfToken });
			deps.session.announce(accountId);
		}
		const next = advance(j, 'legacy-retired-local', deps.now());
		const retired = await deps.keystore.custodyRetire({ accountId, migrationId: j.migrationId, journal: next });
		if (!retired.ok) return refusal(retired);
		j = next;
	}
	if (j.state === 'legacy-retired-local') {
		j = advance(j, 'auth-ready', deps.now());
		await deps.journal.put(j);
	}
	await deps.session.reopen(accountId);
	return DONE;
}

async function finalize(journal: CustodyJournal, grant: CustodySessionGrant, deps: CustodyDeps): Promise<CustodyOutcome> {
	const accountId = journal.accountId;
	const next = advance({ ...journal, exchange: null }, 'mail-committed', deps.now());
	const local = await deps.keystore.custodyCommit({ accountId, migrationId: journal.migrationId, journal: next });
	if (!local.ok) return refusal(local);
	await deps.session.adopt(accountId, grant);
	deps.session.announce(accountId);
	return settle(next, deps);
}

async function reconcile(journal: CustodyJournal, deps: CustodyDeps): Promise<{ outcome: CustodyOutcome } | { journal: CustodyJournal }> {
	const exchange = journal.exchange!;
	const { csrfToken } = await deps.server.bootstrap();
	try {
		const inst = await deps.server.install(exchange.id, csrfToken, { ticket: exchange.ticket, verifier: exchange.verifier });
		if (inst.committed) return { outcome: await finalize(journal, { accessToken: inst.accessToken, expiresIn: inst.expiresIn, csrfToken: inst.csrfToken }, deps) };
		const resumed: CustodyJournal = { ...journal, exchange: { ...exchange, step: 'installed' }, updatedAt: deps.now() };
		await deps.journal.put(resumed);
		return { journal: resumed };
	} catch (err) {
		if (apiStatus(err) !== 404) throw err;
	}
	const grant = await deps.server.hostRefresh(journal.accountId);
	if (grant) return { outcome: await finalize(journal, { accessToken: grant.accessToken, expiresIn: grant.expiresInSeconds, csrfToken: grant.csrfToken }, deps) };
	return { journal: await restart(journal, journal.target, deps) };
}

async function exchange(accountId: string, existing: CustodyJournal | null, deps: CustodyDeps): Promise<CustodyOutcome> {
	const loaded = await deps.server.cryptoState(accountId);
	if (!loaded.state.features.productKeys) return skipped('disabled');
	let j = existing;
	if (j && exchangeExpired(j.exchange, deps.now())) j = await restart(j, j.target, deps);
	const startId = j?.migrationId ?? deps.uuid();
	let adopted = await adopt(accountId, startId, loaded, deps);
	if ('outcome' in adopted) return adopted.outcome;
	if (j && j.target.digest !== adopted.target.digest) {
		j = await restart(j, adopted.target, deps);
		adopted = await adopt(accountId, j.migrationId, loaded, deps);
		if ('outcome' in adopted) return adopted.outcome;
		if (j.target.digest !== adopted.target.digest) return { status: 'retry', reason: 'target-moved' };
	}
	const target = adopted.target;
	if (!j) {
		const now = deps.now();
		j = { accountId, schema: JOURNAL_SCHEMA, migrationId: startId, state: 'prepared', target, exchange: null, sessionId: null, startedAt: now, updatedAt: now, failure: null };
		await deps.journal.put(j);
	}
	if (!j.exchange) {
		const verifier = b64url(deps.randomBytes(32));
		let prepared: PreparedExchange;
		try {
			prepared = await deps.server.prepare(accountId, { operationId: j.migrationId, codeChallenge: b64url(await challengeS256(verifier)), targetDigest: target.digest });
		} catch (err) {
			if (apiStatus(err) === 409 && apiCode(err) === 'conflict') {
				await restart(j, target, deps);
				return { status: 'retry', reason: 'operation-conflict' };
			}
			throw err;
		}
		j = { ...j, exchange: { id: prepared.migrationId, ticket: prepared.ticket, verifier, expiresAt: Date.parse(prepared.expiresAt), step: 'reserved', durable: false }, updatedAt: deps.now() };
		await deps.journal.put(j);
	}
	const { csrfToken } = await deps.server.bootstrap();
	const inst = await deps.server.install(j.exchange!.id, csrfToken, { ticket: j.exchange!.ticket, verifier: j.exchange!.verifier });
	if (inst.accountId !== accountId) return { status: 'blocked', reason: 'exchange-names-another-account' };
	const grant: CustodySessionGrant = { accessToken: inst.accessToken, expiresIn: inst.expiresIn, csrfToken: inst.csrfToken };
	if (inst.committed) return finalize(stagedState(j, deps), grant, deps);
	j = { ...j, sessionId: inst.sessionId, exchange: { ...j.exchange!, step: 'installed' }, updatedAt: deps.now() };
	await deps.journal.put(j);
	const staged = await deps.keystore.custodyStage({ accountId, migrationId: j.migrationId, serverHalf: inst.serverHalf ?? null });
	if (!staged.ok) return refusal(staged);
	j = stagedState({ ...j, exchange: { ...j.exchange!, step: 'staged', durable: staged.durable } }, deps);
	await deps.journal.put(j);
	j = { ...j, exchange: { ...j.exchange!, step: 'committing' }, updatedAt: deps.now() };
	await deps.journal.put(j);
	let committed: CommittedExchange;
	try {
		committed = await deps.server.commit(j.exchange!.id, inst.accessToken, { targetDigest: target.digest });
	} catch (err) {
		const status = apiStatus(err);
		if (status === 409 || status === 404 || status === 401) {
			await restart(j, target, deps);
			return { status: 'retry', reason: status === 409 ? 'target-moved' : 'exchange-refused' };
		}
		throw err;
	}
	if (committed.accountId !== accountId) return { status: 'blocked', reason: 'exchange-names-another-account' };
	return finalize(j, { ...grant, csrfToken: committed.csrfToken ?? grant.csrfToken }, deps);
}

function stagedState(j: CustodyJournal, deps: CustodyDeps): CustodyJournal {
	return j.state === 'prepared' ? advance(j, 'mail-staged', deps.now()) : { ...j, updatedAt: deps.now() };
}

async function failed(accountId: string, err: unknown, deps: CustodyDeps): Promise<CustodyOutcome> {
	const status = apiStatus(err);
	const code = apiCode(err) ?? (err instanceof Error ? err.name : 'unknown');
	const journal = await deps.journal.get(accountId).catch(() => null);
	if (journal && readable(journal)) {
		await deps.journal.put({ ...journal, failure: { code, state: journal.state, at: deps.now() } }).catch(() => {});
	}
	if (status === 403 && code === 'auth_origin_unavailable') return skipped('not-enrolled');
	if (status === null || status >= 500 || status === 429) return { status: 'retry', reason: code };
	return { status: 'blocked', reason: code };
}

async function run(accountId: string, deps: CustodyDeps): Promise<CustodyOutcome> {
	let journal = await deps.journal.get(accountId);
	if (!readable(journal)) return skipped('newer-build');
	if (isSettled(journal)) return DONE;
	try {
		if (journal && isProductCustody(journal)) return await settle(journal, deps);
		if (journal?.exchange?.step === 'committing') {
			const r = await reconcile(journal, deps);
			if ('outcome' in r) return r.outcome;
			journal = r.journal;
		}
		if (!deps.session.enrolled(accountId)) return skipped('not-enrolled');
		if (deps.session.hostBound(accountId)) return skipped('host-session');
		const account = (await deps.keystore.status()).accounts.find((a) => a.accountId === accountId);
		if (!account?.unlocked) return skipped('locked');
		if (account.mailOnly || account.authScheme !== 'opaque_v1') return skipped('unsupported');
		return await exchange(accountId, journal, deps);
	} catch (err) {
		return failed(accountId, err, deps);
	}
}

export async function migrateMailCustody(accountId: string, deps: CustodyDeps): Promise<CustodyOutcome> {
	return (await deps.lock(accountId, () => run(accountId, deps))) ?? skipped('busy');
}
