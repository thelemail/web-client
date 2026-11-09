import { utf8 } from '$core/keystore/productkeys/canonical';
import { bytesEqual, sha256 } from '$core/keystore/productkeys/encoding';
import { putRequest, purgeExpiredRequests } from '$core/keystore/handoff/store';
import { b64url, challengeS256, parseDescriptor } from '$core/keystore/handoff/wire';
import { productTarget } from '$core/products';
import { bootstrap, createRequest } from './api';

export const HANDOFF_TAB_PREFIX = 'thelemail-handoff:';

export class HandoffError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(`handoff: ${code}`);
		this.code = code;
	}
}

export function safeRoute(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/auth/')) return '/';
	return value;
}

export interface StartOptions {
	expectedAccountId: string | null;
	route: string;
	remember: boolean;
}

export async function startHandoff(opts: StartOptions): Promise<void> {
	const authTarget = productTarget('auth');
	if (!authTarget) throw new HandoffError('unavailable');
	await purgeExpiredRequests().catch(() => []);
	const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
	const receiverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const codeChallenge = b64url(await challengeS256(verifier));
	const { csrfToken } = await bootstrap();
	const created = await createRequest(
		{
			state,
			codeChallenge,
			codeChallengeMethod: 'S256',
			receiverPublicKey: b64url(receiverPublicKey),
			expectedAccountId: opts.expectedAccountId,
			existingSessionId: null
		},
		csrfToken
	);
	const raw = utf8(created.descriptor);
	const descriptor = await parseDescriptor(raw);
	if (
		b64url(await sha256(raw)) !== created.descriptorDigest ||
		descriptor.requestId !== created.requestId ||
		descriptor.origin !== window.location.origin ||
		b64url(descriptor.state) !== state ||
		b64url(descriptor.codeChallenge) !== codeChallenge ||
		!bytesEqual(descriptor.receiverPublicKey, receiverPublicKey) ||
		descriptor.expectedAccountId !== opts.expectedAccountId
	) {
		throw new HandoffError('descriptor');
	}
	await putRequest({
		requestId: descriptor.requestId,
		privateKey: pair.privateKey,
		receiverPublicKey,
		verifier,
		state,
		descriptorDigest: created.descriptorDigest,
		clientId: descriptor.clientId,
		callback: descriptor.callback,
		expectedAccountId: opts.expectedAccountId,
		route: safeRoute(opts.route),
		remember: opts.remember,
		createdAt: descriptor.createdAt,
		expiresAt: descriptor.expiresAt
	});
	sessionStorage.setItem(HANDOFF_TAB_PREFIX + descriptor.requestId, state);
	const fragment = new URLSearchParams({ request: descriptor.requestId, digest: created.descriptorDigest });
	window.location.assign(`${authTarget.origin}/authorize#${fragment.toString()}`);
}
