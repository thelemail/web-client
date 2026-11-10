// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProductCandidateResponse } from '$core/api/productKeys';
import { ApiCallError } from '$core/api/types';
import { candidateHash, encodeCandidate } from '$core/keystore/productkeys/candidate';
import { b64decode, b64encode } from '$core/keystore/productkeys/encoding';
import { transcriptHash } from '$core/keystore/productkeys/envelope';
import { DOMAIN, encodeIdentityManifest } from '$core/keystore/productkeys/manifests';
import { PROFILE } from '$core/keystore/productkeys/profiles';
import type { CustodyDeps, CustodyOutcome } from './driver';
import { migrateMailCustody } from './driver';
import type { CustodyJournal } from './journal';

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const BUNDLE = '0f6c9a1e-2b3d-4c5e-8f7a-9b0c1d2e3f40';

class Dead extends Error {}

function apiError(status: number, code: string): ApiCallError {
	return new ApiCallError(status, { error: { code, message: code } } as never, code);
}

interface Exchange {
	id: string;
	operationId: string;
	digest: string;
	status: 'prepared' | 'installed' | 'committed' | 'cancelled';
	ticket: string;
	half: string | null;
	token: string;
}

class World {
	steps = 0;
	killAt = 0;
	dead = false;
	fail = new Map<string, () => Error>();
	ids = 0;

	enrolled = true;
	productKeys = true;
	remembered = true;
	headVersion = 1;
	candidate: { record: Uint8Array; rootBundle: Uint8Array } | null = null;
	committedManifest: Uint8Array | null = null;
	claims = 0;
	exchanges = new Map<string, Exchange>();
	legacySessionLive = true;
	hostSession: string | null = null;
	migrationCookie: string | null = null;
	commits = 0;

	journals = new Map<string, CustodyJournal>();
	vault: 'legacy' | 'mail' | 'none' = 'legacy';
	unlocked = true;
	pending = new Map<string, { digest: string; staged: boolean; durable: boolean }>();
	stagedRecord: string | null = null;
	custodyRecord = false;
	legacyRecord = true;
	mailOnly = false;

	slotHost = false;
	token: string | null = 'legacy-token';
	announced = 0;
	reopened = 0;

	tick(name: string): void {
		if (this.dead) throw new Dead(name);
		this.steps += 1;
		if (this.killAt && this.steps === this.killAt) {
			this.dead = true;
			throw new Dead(name);
		}
		const f = this.fail.get(name);
		if (f) {
			this.fail.delete(name);
			throw f();
		}
	}

	revive(restartWorker: boolean): void {
		this.dead = false;
		this.killAt = 0;
		if (restartWorker) {
			this.pending.clear();
			if (this.vault === 'legacy') this.unlocked = true;
			else if (this.vault === 'mail') {
				this.unlocked = this.custodyRecord;
			}
		}
	}

	async candidateRecord(): Promise<{ record: Uint8Array; rootBundle: Uint8Array }> {
		const rootBundle = crypto.getRandomValues(new Uint8Array(48));
		const record = encodeCandidate({
			accountId: ACCOUNT,
			product: 'app',
			productKeyEpoch: 1,
			amkEpoch: 1,
			rootBundleId: crypto.randomUUID(),
			rootBundleRevision: 1,
			rootBundleCiphertextHash: crypto.getRandomValues(new Uint8Array(32)),
			bundles: [{ bundleId: BUNDLE, revision: 1, ciphertextHash: new Uint8Array(32).fill(3), byteLength: 10, profileId: PROFILE.productBundleV1 }]
		});
		return { record, rootBundle };
	}

	candidateResponse(claimed: boolean): ProductCandidateResponse {
		const c = this.candidate!;
		return { product: 'app', productKeyEpoch: 1, rootBundleId: crypto.randomUUID(), rootBundleRevision: 1, rootBundle: b64encode(c.rootBundle), record: b64encode(c.record), recordHash: '', claimed };
	}

	async activateHead(): Promise<void> {
		this.headVersion = 2;
		this.committedManifest = encodeIdentityManifest({
			accountId: ACCOUNT,
			product: 'app',
			productKeyEpoch: 1,
			manifestId: crypto.randomUUID(),
			revision: 1,
			previousManifestHash: null,
			authorityKeyId: crypto.randomUUID(),
			authorityEpoch: 1,
			delegationHash: new Uint8Array(32).fill(1),
			issuedAt: '2026-11-10T00:00:00Z',
			identityKeys: [],
			bundles: [{ bundleId: BUNDLE, revision: 1, ciphertextHash: new Uint8Array(32).fill(3), byteLength: 10, profileId: PROFILE.productBundleV1 }]
		});
	}

	async targetDigest(): Promise<string | null> {
		if (this.headVersion === 2) return b64encode(await transcriptHash(DOMAIN.identityManifest, this.committedManifest!));
		return this.candidate ? b64encode(await candidateHash(this.candidate.record)) : null;
	}

	deps(): CustodyDeps {
		const w = this;
		return {
			now: () => 1_000_000 + w.steps,
			uuid: () => `00000000-0000-4000-8000-${String(++w.ids).padStart(12, '0')}`,
			randomBytes: (n) => new Uint8Array(n).fill(7),
			lock: async (_id, run) => run(),
			journal: {
				async get(accountId) {
					w.tick('journal.get');
					return w.journals.get(accountId) ?? null;
				},
				async put(journal) {
					w.tick('journal.put');
					w.journals.set(journal.accountId, structuredClone(journal));
				}
			},
			keystore: {
				async status() {
					w.tick('status');
					if (w.vault === 'none' || (!w.unlocked && !w.legacyRecord && !w.custodyRecord)) return { accounts: [] };
					return { accounts: [{ accountId: ACCOUNT, email: 'calloway@thelemail.test', unlocked: w.unlocked, hasPersistent: w.custodyRecord, authScheme: 'opaque_v1', ...(w.mailOnly ? { mailOnly: true } : {}) }] };
				},
				async custodyPrepare() {
					w.tick('custodyPrepare');
					if (w.vault !== 'legacy' || !w.unlocked) return { ok: false, code: 'locked' };
					const c = await w.candidateRecord();
					return { ok: true, upload: { rootBundleId: crypto.randomUUID(), rootBundleRevision: 1, rootBundle: c.rootBundle, record: c.record, bundles: [{ product: 'app', bundleId: BUNDLE, revision: 1, bundle: new Uint8Array(10) }] } };
				},
				async custodyAdopt(args) {
					w.tick('custodyAdopt');
					if (w.vault !== 'legacy' || !w.unlocked) return { ok: false, code: 'locked' };
					const digest = args.source.kind === 'candidate' ? await candidateHash(args.source.stored.record) : await transcriptHash(DOMAIN.identityManifest, args.source.stored.identityManifest);
					w.pending.set(args.migrationId, { digest: b64encode(digest), staged: false, durable: false });
					return { ok: true, kind: args.source.kind, digest, keyCount: 3 };
				},
				async custodyStage(args) {
					w.tick('custodyStage');
					const p = w.pending.get(args.migrationId);
					if (!p) return { ok: false, code: 'missing' };
					p.staged = true;
					p.durable = args.serverHalf !== null;
					w.stagedRecord = p.durable ? args.migrationId : null;
					return { ok: true, durable: p.durable };
				},
				async custodyCommit(args) {
					w.tick('custodyCommit');
					if (w.commits === 0) throw new Error('test: local commit before the server commit');
					const p = w.pending.get(args.migrationId);
					if (p && !p.staged) return { ok: false, code: 'missing' };
					w.custodyRecord = p ? p.durable : w.stagedRecord === args.migrationId;
					w.stagedRecord = null;
					w.vault = 'mail';
					w.mailOnly = true;
					w.unlocked = !!p;
					w.pending.delete(args.migrationId);
					w.journals.set(ACCOUNT, structuredClone(args.journal));
					return { ok: true };
				},
				async custodyRetire(args) {
					w.tick('custodyRetire');
					if (w.vault !== 'mail') throw new Error('test: legacy custody retired before the local commit');
					w.legacyRecord = false;
					w.journals.set(ACCOUNT, structuredClone(args.journal));
					return { ok: true };
				},
				async custodyDiscard(args) {
					w.tick('custodyDiscard');
					w.pending.delete(args.migrationId);
					if (w.stagedRecord === args.migrationId) w.stagedRecord = null;
				}
			},
			server: {
				async cryptoState() {
					w.tick('cryptoState');
					return {
						state: {
							scope: { scopeType: 'account', scopeId: ACCOUNT, stateRevision: 0, activeKeyEpoch: 1, activeGeneration: 1, authEpoch: 1, recoveryEpoch: 0, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 0, keyHistoryRoot: b64encode(new Uint8Array(32)) },
							sessionEpoch: 1,
							credentialGeneration: 1,
							head: w.headVersion === 2 ? { version: 2, stateRevision: 1, head: '', headHash: '', previousHeadHash: null, authoritySignature: null, legacySignature: null, transitionSignature: null, mac: '' } : null,
							credentials: [],
							slots: [],
							bundles: [],
							keys: [],
							history: { start: 0, end: 0, predecessor: '', events: [], nextCursor: null },
							features: { productKeys: w.productKeys }
						},
						events: []
					};
				},
				async accountKeys() {
					w.tick('accountKeys');
					return { currentVersion: 1, keys: [] } as never;
				},
				async aliasGrants() {
					w.tick('aliasGrants');
					return [];
				},
				async productKeys() {
					w.tick('productKeys');
					return {
						product: 'app',
						head: { version: 2, stateRevision: 1, head: b64encode(new Uint8Array(4)), headHash: '', previousHeadHash: null, authoritySignature: null, legacySignature: null, transitionSignature: null, mac: b64encode(new Uint8Array(32)) },
						authorityKey: null,
						identityManifest: { kind: 'identity', revision: 1, page: 1, pageCount: 1, record: b64encode(w.committedManifest!), signature: '', recordHash: '' },
						dataManifest: [],
						delegation: null
					};
				},
				async productBundle() {
					w.tick('productBundle');
					return b64encode(new Uint8Array(10));
				},
				async rootDescriptor() {
					w.tick('rootDescriptor');
					return { bundleId: crypto.randomUUID(), bundleRevision: 1, bundle: b64encode(new Uint8Array(40)) };
				},
				async candidate() {
					w.tick('candidate');
					return w.candidate ? w.candidateResponse(false) : null;
				},
				async putCandidateBundle() {
					w.tick('putCandidateBundle');
				},
				async claimCandidate(_id, body) {
					w.tick('claimCandidate');
					if (w.headVersion === 2) throw apiError(409, 'product_keys_committed');
					w.claims += 1;
					if (!w.candidate) {
						w.candidate = { record: b64decode(body.record), rootBundle: b64decode(body.rootBundle) };
						return w.candidateResponse(true);
					}
					return w.candidateResponse(false);
				},
				async prepare(_id, body) {
					w.tick('prepare');
					if (!w.enrolled) throw apiError(403, 'auth_origin_unavailable');
					if (!w.legacySessionLive) throw apiError(401, 'invalid_credentials');
					if (body.targetDigest !== (await w.targetDigest())) throw apiError(409, 'crypto_state_stale');
					for (const e of w.exchanges.values()) {
						if (e.operationId === body.operationId) {
							if (e.status !== 'prepared') throw apiError(404, 'not_found');
							return { migrationId: e.id, ticket: e.ticket, expiresAt: new Date(2_000_000).toISOString() };
						}
						if (e.status === 'prepared' || e.status === 'installed') e.status = 'cancelled';
					}
					const e: Exchange = { id: crypto.randomUUID(), operationId: body.operationId, digest: body.targetDigest, status: 'prepared', ticket: `ticket-${w.exchanges.size}`, half: null, token: `child-${w.exchanges.size}` };
					w.exchanges.set(e.id, e);
					return { migrationId: e.id, ticket: e.ticket, expiresAt: new Date(2_000_000).toISOString() };
				},
				async bootstrap() {
					w.tick('bootstrap');
					return { csrfToken: 'csrf' };
				},
				async install(id, _csrf, body) {
					w.tick('install');
					const e = w.exchanges.get(id);
					if (!e || e.ticket !== body.ticket || e.status === 'cancelled') throw apiError(404, 'not_found');
					if (e.status === 'committed') {
						if (w.migrationCookie !== e.id) throw apiError(404, 'not_found');
						w.hostSession = e.token;
						w.migrationCookie = null;
						return { migrationId: id, accountId: ACCOUNT, sessionId: `s-${e.token}`, accessToken: e.token, expiresIn: 600, committed: true, csrfToken: 'host-csrf' };
					}
					if (e.status === 'prepared') {
						if (!w.legacySessionLive) throw apiError(404, 'not_found');
						e.status = 'installed';
						e.half = w.remembered ? 'aGFsZg==' : null;
					}
					w.migrationCookie = e.id;
					return { migrationId: id, accountId: ACCOUNT, sessionId: `s-${e.token}`, accessToken: e.token, expiresIn: 600, committed: false, ...(e.half ? { serverHalf: e.half } : {}) };
				},
				async commit(id, token, body) {
					w.tick('commit');
					const e = w.exchanges.get(id);
					if (!e || e.token !== token) throw apiError(404, 'not_found');
					if (e.status === 'committed') return { accountId: ACCOUNT, sessionId: `s-${e.token}`, cookieInstalled: true, csrfToken: 'host-csrf' };
					if (e.status !== 'installed') throw apiError(401, 'invalid_credentials');
					if (body.targetDigest !== e.digest || e.digest !== (await w.targetDigest())) throw apiError(409, 'crypto_state_stale');
					const p = [...w.pending.values()].find((x) => x.staged);
					if (!p) throw new Error('test: server commit before the staged vault was verified');
					e.status = 'committed';
					w.commits += 1;
					w.legacySessionLive = false;
					const lost = w.fail.get('commit.response');
					if (lost) {
						w.fail.delete('commit.response');
						throw lost();
					}
					w.hostSession = e.token;
					w.migrationCookie = null;
					return { accountId: ACCOUNT, sessionId: `s-${e.token}`, cookieInstalled: true, csrfToken: 'host-csrf' };
				},
				async hostRefresh() {
					w.tick('hostRefresh');
					if (!w.hostSession) return null;
					return { accessToken: w.hostSession, expiresInSeconds: 600, accountId: ACCOUNT, csrfToken: 'host-csrf' } as never;
				}
			},
			session: {
				enrolled: () => w.enrolled,
				hostBound: () => w.slotHost,
				async adopt(_id, grant) {
					w.tick('session.adopt');
					w.token = grant.accessToken;
					w.slotHost = true;
				},
				async reopen() {
					w.tick('session.reopen');
					w.reopened += 1;
					if (w.vault === 'mail' && w.custodyRecord) w.unlocked = true;
				},
				announce() {
					w.announced += 1;
				}
			}
		};
	}

	settled(): void {
		expect(this.journals.get(ACCOUNT)?.state).toBe('auth-ready');
		expect(this.journals.get(ACCOUNT)?.exchange).toBeNull();
		expect(this.commits).toBe(1);
		expect(this.legacySessionLive).toBe(false);
		expect([...this.exchanges.values()].filter((e) => e.status === 'committed')).toHaveLength(1);
		expect(this.vault).toBe('mail');
		expect(this.legacyRecord).toBe(false);
		expect(this.slotHost).toBe(true);
		expect(this.token).toBe([...this.exchanges.values()].find((e) => e.status === 'committed')!.token);
		expect(this.stagedRecord).toBeNull();
	}
}

let w: World;

async function run(): Promise<CustodyOutcome> {
	return migrateMailCustody(ACCOUNT, w.deps());
}

beforeEach(() => {
	w = new World();
});

describe('mail custody migration', () => {
	it('migrates an unlocked remembered account in one pass', async () => {
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.custodyRecord).toBe(true);
		expect(w.unlocked).toBe(true);
		expect(w.claims).toBe(1);
		expect(w.announced).toBe(1);
		expect(await run()).toEqual({ status: 'done' });
		expect(w.commits).toBe(1);
	});

	it('keeps a session that was not remembered in memory only', async () => {
		w.remembered = false;
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.custodyRecord).toBe(false);
		expect(w.unlocked).toBe(true);
	});

	it('adopts the committed root when the account already converted at auth', async () => {
		await w.activateHead();
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.claims).toBe(0);
		expect(w.journals.get(ACCOUNT)?.target.kind).toBe('committed');
	});

	it('adopts another device candidate instead of claiming its own', async () => {
		w.candidate = await w.candidateRecord();
		const digest = await w.targetDigest();
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.claims).toBe(0);
		expect(w.journals.get(ACCOUNT)?.target).toEqual({ kind: 'candidate', digest });
	});

	it('adopts the winner when it loses the claim race', async () => {
		const other = await w.candidateRecord();
		w.fail.set('claimCandidate', () => {
			w.candidate = other;
			return apiError(503, 'service_unavailable');
		});
		expect((await run()).status).toBe('retry');
		expect(w.vault).toBe('legacy');
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.journals.get(ACCOUNT)?.target.digest).toBe(b64encode(await candidateHash(other.record)));
	});

	it('switches to the committed root when the head lands during the claim', async () => {
		w.fail.set('putCandidateBundle', () => {
			void w.activateHead();
			return apiError(503, 'service_unavailable');
		});
		expect((await run()).status).toBe('retry');
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.journals.get(ACCOUNT)?.target.kind).toBe('committed');
	});

	it('restarts the exchange when the target moves before commit', async () => {
		w.fail.set('custodyStage', () => {
			void w.activateHead();
			return apiError(503, 'service_unavailable');
		});
		expect((await run()).status).toBe('retry');
		expect(w.vault).toBe('legacy');
		expect(w.legacySessionLive).toBe(true);
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.journals.get(ACCOUNT)?.target.kind).toBe('committed');
		expect([...w.exchanges.values()].filter((e) => e.status === 'cancelled').length).toBeGreaterThan(0);
	});

	it('does nothing for accounts it must not touch', async () => {
		w.enrolled = false;
		expect(await run()).toEqual({ status: 'skipped', reason: 'not-enrolled' });
		w.enrolled = true;
		w.productKeys = false;
		expect(await run()).toEqual({ status: 'skipped', reason: 'disabled' });
		w.productKeys = true;
		w.unlocked = false;
		expect(await run()).toEqual({ status: 'skipped', reason: 'locked' });
		w.unlocked = true;
		w.slotHost = true;
		expect(await run()).toEqual({ status: 'skipped', reason: 'host-session' });
		expect(w.journals.size).toBe(0);
		expect(w.exchanges.size).toBe(0);
		expect(w.vault).toBe('legacy');
		expect(w.legacyRecord).toBe(true);
	});

	it('leaves a journal from a newer build alone', async () => {
		w.journals.set(ACCOUNT, { accountId: ACCOUNT, schema: 2, migrationId: 'x', state: 'prepared', target: { kind: 'candidate', digest: '' }, exchange: null, sessionId: null, startedAt: 0, updatedAt: 0, failure: null });
		expect(await run()).toEqual({ status: 'skipped', reason: 'newer-build' });
		expect(w.steps).toBe(1);
	});

	it('recovers a commit whose response was lost', async () => {
		w.fail.set('commit.response', () => new TypeError('Failed to fetch'));
		expect((await run()).status).toBe('retry');
		expect(w.commits).toBe(1);
		expect(w.vault).toBe('legacy');
		expect(w.journals.get(ACCOUNT)?.exchange?.step).toBe('committing');
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.unlocked).toBe(true);
	});

	it('recovers a lost commit response after the worker also restarted', async () => {
		w.fail.set('commit.response', () => new TypeError('Failed to fetch'));
		expect((await run()).status).toBe('retry');
		w.revive(true);
		w.unlocked = false;
		expect(await run()).toEqual({ status: 'done' });
		w.settled();
		expect(w.custodyRecord).toBe(true);
		expect(w.unlocked).toBe(true);
		expect(w.reopened).toBeGreaterThan(0);
	});

	it('records why a run failed without losing its place', async () => {
		w.fail.set('install', () => apiError(503, 'service_unavailable'));
		expect(await run()).toEqual({ status: 'retry', reason: 'service_unavailable' });
		const j = w.journals.get(ACCOUNT)!;
		expect(j.state).toBe('prepared');
		expect(j.exchange?.step).toBe('reserved');
		expect(j.failure).toMatchObject({ code: 'service_unavailable', state: 'prepared' });
		expect(await run()).toEqual({ status: 'done' });
		expect(w.journals.get(ACCOUNT)?.failure).toBeNull();
		expect(w.exchanges.size).toBe(1);
	});
});

describe('process death at every step', () => {
	for (const remembered of [true, false]) {
		for (const restartWorker of [false, true]) {
			it(`remembered=${remembered} workerRestart=${restartWorker}: no step leaves the account without keys or session`, async () => {
				const probe = new World();
				probe.remembered = remembered;
				w = probe;
				await run();
				const total = probe.steps;
				expect(total).toBeGreaterThan(20);

				for (let at = 1; at <= total; at++) {
					w = new World();
					w.remembered = remembered;
					w.killAt = at;
					await run().catch((err) => {
						if (!(err instanceof Dead)) throw err;
					});
					const serverCommitted = w.commits === 1;
					if (!serverCommitted) {
						expect(w.legacySessionLive, `kill at ${at}: legacy session`).toBe(true);
						expect(w.legacyRecord, `kill at ${at}: legacy record`).toBe(true);
						expect(w.vault, `kill at ${at}: vault`).toBe('legacy');
					}
					w.revive(restartWorker);
					let outcome: CustodyOutcome = { status: 'retry', reason: 'start' };
					for (let attempt = 0; attempt < 4 && outcome.status !== 'done'; attempt++) {
						outcome = await run();
						if (outcome.status === 'skipped' && outcome.reason === 'locked') break;
					}
					const lostMemoryVault = restartWorker && !remembered && serverCommitted && w.vault === 'mail' && !w.unlocked;
					const lockedBeforeCommit = outcome.status === 'skipped';
					if (lockedBeforeCommit) {
						expect(w.vault, `kill at ${at}`).toBe('legacy');
						expect(w.legacyRecord, `kill at ${at}`).toBe(true);
						expect(w.legacySessionLive, `kill at ${at}`).toBe(true);
						continue;
					}
					expect(outcome, `kill at ${at}`).toEqual({ status: 'done' });
					w.settled();
					if (remembered) expect(w.unlocked, `kill at ${at}: remembered vault reopens`).toBe(true);
					if (!remembered && !lostMemoryVault) expect(w.unlocked, `kill at ${at}: live vault kept`).toBe(true);
				}
			});
		}
	}
});
