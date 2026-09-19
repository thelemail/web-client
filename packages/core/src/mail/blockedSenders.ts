import { addBlockedSender } from '$core/api/blockedSenders';
import type { BlockedSender } from '$core/api/types';
import { b64ToBytes, bytesToB64 } from '$core/crypto';
import { keystore } from '$core/keystore/keystore-client';
import { m } from '$paraglide/messages.js';

export function normalizeAddress(address: string): string {
	return address.trim().toLowerCase();
}

export async function sealAddress(accountId: string, address: string): Promise<string> {
	const key = await keystore.getPublicKey({ accountId });
	if (!key.ok) {
		throw new Error(m.mailbox_block_unlock_required());
	}
	const res = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: key.publicKeyArmored,
		plaintext: new TextEncoder().encode(normalizeAddress(address))
	});
	if (!res.ok) {
		throw new Error(m.mailbox_block_seal_failed());
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
