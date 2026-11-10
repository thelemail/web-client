import { browser } from '$app/env';
import { listMyAliasKeys } from '$core/api/aliases';
import { refreshSession } from '$core/api/auth';
import { listMyKeys } from '$core/api/me';
import {
	claimProductCandidate,
	getProductBundle,
	getProductCandidate,
	getProductKeys,
	getProductRootDescriptor,
	putProductCandidateBundle
} from '$core/api/productKeys';
import { ApiCallError } from '$core/api/types';
import { loadCryptoState } from '$core/auth/product-keys';
import { keystore } from '$core/keystore/keystore-client';
import { bootstrap } from '$core/producthandoff/api';
import { accounts } from '$core/stores/accounts.svelte';
import { auth, sessionBase } from '$core/stores/session.svelte';
import { commitExchange, installExchange, prepareExchange } from './api';
import type { CustodyDeps, CustodyOutcome } from './driver';
import { migrateMailCustody } from './driver';
import { isProductCustody, readable } from './journal';
import { getJournal, putJournal } from './store';

const CHANNEL = 'thelemail-custody';
const LOCK_PREFIX = 'thelemail-custody:';
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

function lockName(accountId: string): string {
	return LOCK_PREFIX + accountId;
}

async function tryLock<T>(accountId: string, run: () => Promise<T>): Promise<T | null> {
	if (typeof navigator === 'undefined' || !navigator.locks) return run();
	return navigator.locks.request(lockName(accountId), { ifAvailable: true }, (lock) => (lock ? run() : null));
}

async function waitLock<T>(accountId: string, run: () => Promise<T>): Promise<T | null> {
	if (typeof navigator === 'undefined' || !navigator.locks) return run();
	return navigator.locks.request(lockName(accountId), () => run());
}

let channel: BroadcastChannel | null = null;

function announce(accountId: string): void {
	try {
		channel?.postMessage({ type: 'custodyChanged', accountId });
	} catch {
		return;
	}
}

async function notFoundAsNull<T>(run: () => Promise<T>): Promise<T | null> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 404) return null;
		throw err;
	}
}

export function custodyDeps(lock: CustodyDeps['lock'] = tryLock): CustodyDeps {
	return {
		now: () => Date.now(),
		uuid: () => crypto.randomUUID(),
		randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
		lock,
		journal: { get: getJournal, put: putJournal },
		keystore,
		server: {
			cryptoState: loadCryptoState,
			accountKeys: (accountId) => listMyKeys(accountId),
			aliasGrants: async (accountId) => (await listMyAliasKeys(accountId)).keys,
			productKeys: (accountId) => getProductKeys(accountId, 'app'),
			productBundle: async (accountId, bundleId, revision) => (await getProductBundle(accountId, 'app', bundleId, revision)).bundle,
			rootDescriptor: (accountId) => getProductRootDescriptor(accountId, 'app'),
			candidate: (accountId) => notFoundAsNull(() => getProductCandidate(accountId, 'app')),
			putCandidateBundle: (accountId, bundleId, revision, bundle) => putProductCandidateBundle(accountId, 'app', bundleId, revision, bundle),
			claimCandidate: (accountId, body) => claimProductCandidate(accountId, 'app', body),
			prepare: prepareExchange,
			bootstrap,
			install: installExchange,
			commit: commitExchange,
			hostRefresh: async (accountId) => {
				try {
					return await refreshSession(accountId, window.location.origin);
				} catch (err) {
					if (err instanceof ApiCallError && err.status >= 400 && err.status < 500) return null;
					throw err;
				}
			}
		},
		session: {
			enrolled: (accountId) => auth.authOriginEnrolledFor(accountId),
			hostBound: (accountId) => accounts.byId(accountId)?.sessionOrigin === 'host',
			adopt: (accountId, grant) => auth.adoptHostSession(accountId, grant.accessToken, grant.expiresIn, grant.csrfToken),
			reopen: async (accountId) => {
				await auth.syncVaultStatus();
				await auth.ensureVaultUnlocked(accountId);
			},
			announce
		}
	};
}

export async function recoverMailSession(accountId: string, triedBase: string | undefined): Promise<boolean> {
	const moved = async () => {
		await accounts.refresh();
		return sessionBase(accountId) !== triedBase;
	};
	if (await moved()) return true;
	const journal = await getJournal(accountId).catch(() => null);
	if (!journal || !readable(journal)) return false;
	if (!isProductCustody(journal) && journal.exchange?.step !== 'committing') return false;
	await migrateMailCustody(accountId, custodyDeps(waitLock));
	return moved();
}

const attempts = new Map<string, number>();
const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let reloadWhenHidden = false;

function reloadIfHidden(): void {
	if (reloadWhenHidden && document.visibilityState === 'hidden') window.location.reload();
}

async function attempt(accountId: string): Promise<void> {
	if (running.has(accountId)) return;
	running.add(accountId);
	let outcome: CustodyOutcome;
	try {
		outcome = await migrateMailCustody(accountId, custodyDeps());
	} catch (err) {
		outcome = { status: 'retry', reason: err instanceof Error ? err.name : 'unknown' };
	} finally {
		running.delete(accountId);
	}
	if (outcome.status === 'retry') {
		const n = attempts.get(accountId) ?? 0;
		attempts.set(accountId, n + 1);
		const delay = RETRY_DELAYS_MS[n];
		if (delay !== undefined) schedule(accountId, delay);
		return;
	}
	if (outcome.status === 'blocked') {
		console.warn('custody: migration blocked', outcome.reason);
		return;
	}
	if (outcome.status === 'skipped' && outcome.reason === 'newer-build') {
		reloadWhenHidden = true;
		reloadIfHidden();
	}
}

function schedule(accountId: string, delayMs: number): void {
	const pending = timers.get(accountId);
	if (pending) clearTimeout(pending);
	timers.set(
		accountId,
		setTimeout(() => {
			timers.delete(accountId);
			void attempt(accountId);
		}, delayMs)
	);
}

let started = false;

export function startMailCustody(): void {
	if (!browser || started) return;
	started = true;
	auth.registerSessionRecovery(recoverMailSession);
	try {
		channel = new BroadcastChannel(CHANNEL);
		channel.onmessage = (ev: MessageEvent<{ type?: string; accountId?: string }>) => {
			const accountId = ev.data?.accountId;
			if (ev.data?.type !== 'custodyChanged' || typeof accountId !== 'string') return;
			void (async () => {
				await accounts.refresh();
				await auth.syncVaultStatus();
				await auth.tryRefresh(accountId);
			})().catch(() => {});
		};
	} catch {
		channel = null;
	}
	document.addEventListener('visibilitychange', reloadIfHidden);
	auth.attach({
		profileLoaded(me) {
			if (me.authOriginEnrolled) schedule(me.accountId, 2_000);
		},
		vaultOpened(accountId) {
			if (auth.authOriginEnrolledFor(accountId)) schedule(accountId, 2_000);
		}
	});
}
