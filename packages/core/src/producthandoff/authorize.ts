import { apiFetch } from '$core/api/client';
import { getCryptoState, getSecretBundle } from '$core/api/productKeys';
import { keystore } from '$core/keystore/keystore-client';
import type { Descriptor } from '$core/keystore/handoff/wire';
import { b64url, parseDescriptor } from '$core/keystore/handoff/wire';
import { utf8 } from '$core/keystore/productkeys/canonical';
import { b64decode, sha256 } from '$core/keystore/productkeys/encoding';
import { parseHeadV2 } from '$core/keystore/productkeys/head';
import type { StoredBundle } from '$core/keystore/productkeys/read';
import { productOrigins } from '$core/products';
import { HandoffError } from './begin';

const PENDING_KEY = 'thelemail-authorize';

export interface LocatedRequest {
	requestId: string;
	digest: string;
	descriptor: Descriptor;
}

export function takeAuthorizeFragment(): string | null {
	const w = window as unknown as { __thelemailAuthorize?: string };
	const fresh = w.__thelemailAuthorize;
	delete w.__thelemailAuthorize;
	if (fresh) {
		sessionStorage.setItem(PENDING_KEY, fresh);
		return fresh;
	}
	return sessionStorage.getItem(PENDING_KEY);
}

export function hasPendingAuthorize(): boolean {
	return sessionStorage.getItem(PENDING_KEY) !== null;
}

export function clearPendingAuthorize(): void {
	sessionStorage.removeItem(PENDING_KEY);
}

export async function locateRequest(fragment: string): Promise<LocatedRequest> {
	const p = new URLSearchParams(fragment.replace(/^#/, ''));
	const requestId = p.get('request');
	const digest = p.get('digest');
	if (!requestId || !/^[0-9a-f-]{36}$/.test(requestId) || !digest || !/^[A-Za-z0-9_-]{43}$/.test(digest)) {
		throw new HandoffError('invalid');
	}
	for (const target of productOrigins()) {
		if (target.audience === 'auth') continue;
		let resp: Response;
		try {
			resp = await fetch(`${target.origin}/v1/auth/handoffs/requests/${requestId}/confirm`, {
				credentials: 'include',
				cache: 'no-store',
				referrerPolicy: 'no-referrer'
			});
		} catch {
			continue;
		}
		if (!resp.ok) continue;
		const body = (await resp.json().catch(() => null)) as { descriptor?: string; descriptorDigest?: string } | null;
		if (!body?.descriptor) continue;
		const raw = utf8(body.descriptor);
		if (b64url(await sha256(raw)) !== digest || body.descriptorDigest !== digest) throw new HandoffError('invalid');
		const descriptor = await parseDescriptor(raw);
		if (descriptor.requestId !== requestId || descriptor.origin !== target.origin || descriptor.product !== target.audience) {
			throw new HandoffError('invalid');
		}
		if (descriptor.expiresAt * 1000 <= Date.now()) throw new HandoffError('invalid');
		return { requestId, digest, descriptor };
	}
	throw new HandoffError('invalid');
}

interface Reservation {
	destinationSessionId: string;
	grant: string;
}

interface Authorization {
	requestId: string;
	code: string;
	state: string;
	callback: string;
}

function toUrl(b64: string): string {
	return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function grantRequest(accountId: string, req: LocatedRequest): Promise<string> {
	const state = await getCryptoState(accountId);
	const head = state.head;
	if (!head || head.version !== 2) throw new HandoffError('incomplete');
	const raw = b64decode(head.head);
	const parsed = parseHeadV2(raw);
	const product = parsed.productDescriptors.find((d) => d.product === req.descriptor.product);
	if (!product) throw new HandoffError('incomplete');
	const committed = new Set(parsed.bundleDescriptorHashes.map((h) => b64url(h)));
	const secretBundles: StoredBundle[] = [];
	for (const b of state.bundles) {
		if (!committed.has(toUrl(b.bytesHash))) continue;
		const got = await getSecretBundle(accountId, b.bundleId, b.bundleRevision);
		secretBundles.push({ bundleId: got.bundleId, revision: got.bundleRevision, bundle: b64decode(got.bundle) });
	}
	const reserved = await apiFetch<Reservation>(`/v1/auth/handoffs/${req.requestId}/reserve`, {
		method: 'POST',
		accountId,
		body: {
			expectedDescriptorHash: req.digest,
			accountId,
			expectedHeadRevision: head.stateRevision,
			expectedHeadHash: toUrl(head.headHash),
			expectedEpochs: {
				credentialGeneration: state.credentialGeneration,
				sessionEpoch: state.sessionEpoch,
				authorityEpoch: parsed.authorityEpoch,
				productKeyEpoch: product.productKeyEpoch
			}
		}
	});
	const sealed = await keystore.sealProductHandoff({
		accountId,
		grant: utf8(reserved.grant),
		receiverPublicKey: req.descriptor.receiverPublicKey,
		head: { raw, mac: b64decode(head.mac) },
		secretBundles
	});
	if (!sealed.ok) throw new HandoffError(sealed.code);
	const envelope = new TextDecoder().decode(sealed.envelope);
	const out = await apiFetch<Authorization>(`/v1/auth/handoffs/${req.requestId}/authorize`, {
		method: 'POST',
		accountId,
		body: { grant: reserved.grant, envelope, envelopeDigest: b64url(await sha256(sealed.envelope)) }
	});
	if (out.callback !== req.descriptor.callback || out.state !== b64url(req.descriptor.state) || out.requestId !== req.requestId) {
		throw new HandoffError('invalid');
	}
	const fragment = new URLSearchParams({ code: out.code, state: out.state, request: out.requestId, iss: window.location.origin });
	return `${out.callback}#${fragment.toString()}`;
}
