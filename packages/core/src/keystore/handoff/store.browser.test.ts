import { describe, expect, it } from 'vitest';
import { ecdhSecret } from './envelope';
import { deleteRequest, getRequest, putRequest } from './store';

describe('handoff request store', () => {
	it('keeps a non-extractable receiver key usable across reads', async () => {
		const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
		const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
		const requestId = crypto.randomUUID();
		await putRequest({
			requestId,
			privateKey: pair.privateKey,
			receiverPublicKey: pub,
			verifier: 'v',
			state: 's',
			descriptorDigest: 'd',
			clientId: 'web-calendar',
			callback: `${location.origin}/auth/callback`,
			expectedAccountId: null,
			route: '/',
			remember: true,
			createdAt: 0,
			expiresAt: Math.floor(Date.now() / 1000) + 600
		});
		const back = await getRequest(requestId);
		expect(back?.privateKey.extractable).toBe(false);
		const peer = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
		const peerPub = new Uint8Array(await crypto.subtle.exportKey('raw', peer.publicKey));
		const ours = await ecdhSecret(back!.privateKey, peerPub);
		const theirs = await ecdhSecret(peer.privateKey, pub);
		expect(Array.from(ours)).toEqual(Array.from(theirs));
		await deleteRequest(requestId);
		expect(await getRequest(requestId)).toBeNull();
	});
});
