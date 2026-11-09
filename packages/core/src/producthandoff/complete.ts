import { ApiCallError } from '$core/api/types';
import { keystore } from '$core/keystore/keystore-client';
import { ecdhSecret } from '$core/keystore/handoff/envelope';
import { deleteRequest, getRequest, putRequest } from '$core/keystore/handoff/store';
import type { HandoffRecord } from '$core/keystore/handoff/store';
import { b64url, fromB64url, parseEnvelope } from '$core/keystore/handoff/wire';
import { utf8 } from '$core/keystore/productkeys/canonical';
import { b64decode, sha256 } from '$core/keystore/productkeys/encoding';
import { parseIdentityManifest } from '$core/keystore/productkeys/manifests';
import type { StoredBundle } from '$core/keystore/productkeys/read';
import { currentProduct, productTarget } from '$core/products';
import { accounts } from '$core/stores/accounts.svelte';
import { auth } from '$core/stores/auth.svelte';
import type { AcknowledgementResponse, RedemptionResponse } from './api';
import { acknowledge, adoption, bootstrap, cancel, productBundle, productKeys, redeem } from './api';
import { HANDOFF_TAB_PREFIX, HandoffError } from './begin';

export interface CompletedHandoff {
	accountId: string;
	slot: number;
	route: string;
}

export function takeCallbackFragment(): string | null {
	const w = window as unknown as { __thelemailCallback?: string };
	const fragment = w.__thelemailCallback ?? null;
	delete w.__thelemailCallback;
	return fragment;
}

const RETRY_DELAYS_MS = [500, 1500, 4000];

function transient(err: unknown): boolean {
	return err instanceof TypeError || (err instanceof ApiCallError && (err.status === 0 || err.status >= 500));
}

async function withRetry<T>(deadline: number, fn: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (!transient(err) || attempt >= RETRY_DELAYS_MS.length || Date.now() + RETRY_DELAYS_MS[attempt] >= deadline) throw err;
			await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
		}
	}
}

function parseFragment(fragment: string): { code: string; state: string; requestId: string; iss: string } {
	const p = new URLSearchParams(fragment.replace(/^#/, ''));
	const code = p.get('code');
	const state = p.get('state');
	const requestId = p.get('request');
	const iss = p.get('iss');
	if (!code || !state || !requestId || !iss) throw new HandoffError('missing');
	return { code, state, requestId, iss };
}

async function loadKeys(token: string) {
	const product = currentProduct as 'app' | 'calendar';
	const view = await productKeys(product, token);
	if (!view.head?.authoritySignature || !view.authorityKey || !view.identityManifest) throw new HandoffError('incomplete');
	const record = b64decode(view.identityManifest.record);
	const bundles: StoredBundle[] = [];
	for (const ref of parseIdentityManifest(record).bundles) {
		const got = await productBundle(product, ref.bundleId, ref.revision, token);
		bundles.push({ bundleId: ref.bundleId, revision: ref.revision, bundle: b64decode(got.bundle) });
	}
	return {
		head: { raw: b64decode(view.head.head), authority: b64decode(view.head.authoritySignature) },
		authorityKey: b64decode(view.authorityKey.publicKey),
		identityManifest: { record, signature: b64decode(view.identityManifest.signature) },
		bundles
	};
}

async function acknowledged(rec: HandoffRecord, red: RedemptionResponse, body: { envelopeDigest: string; identityManifestHash: string }, deadline: number): Promise<AcknowledgementResponse> {
	try {
		return await withRetry(deadline, () => acknowledge(rec.requestId, red.accessToken, body));
	} catch (err) {
		if (!transient(err)) throw err;
		const status = await withRetry(deadline, () => adoption(rec.requestId, red.accessToken));
		if (status.status !== 'acknowledged' || !status.active) throw err;
		return withRetry(deadline, () => acknowledge(rec.requestId, red.accessToken, body));
	}
}

export async function completeHandoff(fragment: string): Promise<CompletedHandoff> {
	const authTarget = productTarget('auth');
	const { code, state, requestId, iss } = parseFragment(fragment);
	if (!authTarget || iss !== authTarget.origin) throw new HandoffError('issuer');
	if (sessionStorage.getItem(HANDOFF_TAB_PREFIX + requestId) !== state) throw new HandoffError('restart');
	const rec = await getRequest(requestId);
	if (!rec || rec.state !== state || rec.expiresAt * 1000 + 360_000 < Date.now()) throw new HandoffError('restart');

	const { csrfToken } = await bootstrap();
	const deadline = Date.now() + 300_000;
	const red = await withRetry(deadline, () =>
		redeem({ requestId, code, state, verifier: rec.verifier, remember: rec.remember }, csrfToken)
	);
	let adopted = false;
	try {
		if (rec.expectedAccountId && red.accountId !== rec.expectedAccountId) throw new HandoffError('account');
		const adoptBy = Date.parse(red.adoptBy);
		await putRequest({ ...rec, adoptBy: Math.floor(adoptBy / 1000), accountId: red.accountId, sessionId: red.sessionId });
		const envelope = utf8(red.envelope);
		const parsed = await parseEnvelope(envelope);
		const sharedSecret = await ecdhSecret(rec.privateKey, parsed.context.senderPublicKey);
		const existing = accounts.byId(red.accountId);
		const result = await keystore.adoptHandoff({
			accountId: red.accountId,
			requestId,
			product: currentProduct as 'app' | 'calendar',
			email: existing?.email ?? '',
			envelope,
			sharedSecret,
			expect: {
				issuer: authTarget.origin,
				origin: window.location.origin,
				clientId: rec.clientId,
				callback: rec.callback,
				destinationSessionId: red.sessionId,
				receiverKeyDigest: await sha256(rec.receiverPublicKey),
				stateHash: await sha256(fromB64url(state))
			},
			keys: await loadKeys(red.accessToken),
			serverHalf: red.serverHalf
		});
		sharedSecret.fill(0);
		if (!result.ok) throw new HandoffError('invalid');
		adopted = true;
		const ack = await acknowledged(
			rec,
			red,
			{ envelopeDigest: b64url(result.envelopeDigest), identityManifestHash: b64url(result.manifestHash) },
			Math.min(adoptBy, deadline)
		);
		if (ack.accountId !== red.accountId || ack.sessionId !== red.sessionId) throw new HandoffError('account');
		const committed = await keystore.commitHandoff({ accountId: red.accountId, requestId });
		if (!committed.ok) throw new HandoffError('invalid');
		const now = Date.now();
		const slot = existing?.slot ?? accounts.allocateSlot();
		await accounts.upsert({
			accountId: red.accountId,
			slot,
			email: existing?.email ?? '',
			addedAt: existing?.addedAt ?? now,
			lastActiveAt: now,
			sessionOrigin: 'host'
		});
		auth.addSession(red.accessToken, red.expiresIn, red.accountId, ack.csrfToken);
		await deleteRequest(requestId).catch(() => undefined);
		sessionStorage.removeItem(HANDOFF_TAB_PREFIX + requestId);
		return { accountId: red.accountId, slot, route: rec.route };
	} catch (err) {
		if (adopted) await keystore.discardHandoff({ accountId: red.accountId, requestId }).catch(() => undefined);
		await cancel(requestId, csrfToken).catch(() => undefined);
		await deleteRequest(requestId).catch(() => undefined);
		sessionStorage.removeItem(HANDOFF_TAB_PREFIX + requestId);
		throw err;
	}
}
