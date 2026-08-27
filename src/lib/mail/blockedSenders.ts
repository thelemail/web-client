import { addBlockedSender } from '$lib/api/blockedSenders';
import type { BlockedSender } from '$lib/api/types';
import { b64ToBytes, bytesToB64 } from '$lib/crypto';
import { keystore } from '$lib/keystore/keystore-client';

export function normalizeAddress(address: string): string {
	return address.trim().toLowerCase();
}

export async function sealAddress(accountId: string, address: string): Promise<string> {
	const key = await keystore.getPublicKey({ accountId });
	if (!key.ok) {
		throw new Error('Unlock this account to block a sender.');
	}
	const res = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: key.publicKeyArmored,
		plaintext: new TextEncoder().encode(normalizeAddress(address))
	});
	if (!res.ok) {
		throw new Error('The address could not be encrypted, so the sender was not blocked.');
	}
	return bytesToB64(res.ciphertext);
}

export async function unsealAddress(
	accountId: string,
	sealedLabel: string | null | undefined
): Promise<string | null> {
	if (!sealedLabel) return null;
	let bytes: Uint8Array;
	try {
		bytes = b64ToBytes(sealedLabel);
	} catch {
		return null;
	}
	const res = await keystore.decrypt({ accountId, ciphertextBinary: bytes });
	if (!res.ok || !('plaintext' in res)) return null;
	const address = res.plaintext.trim();
	return address ? address : null;
}

export async function blockSender(accountId: string, address: string): Promise<BlockedSender> {
	const normalized = normalizeAddress(address);
	const sealedLabel = await sealAddress(accountId, normalized);
	return addBlockedSender({ address: normalized, sealedLabel });
}
