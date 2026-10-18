import * as openpgp from 'openpgp';

export interface StatementFields {
	accountId: string;
	address: string;
	issuedAt: string;
	keyAlgorithm: string;
	keyFingerprint: string;
	keyTransitions?: { previousKeyFingerprint: string; retiredAt: string; signature: string }[];
	signingKeyFingerprint: string;
	version: number;
}

export function statementBytes(s: StatementFields): Uint8Array {
	const ordered: Record<string, unknown> = {
		accountId: s.accountId,
		address: s.address,
		issuedAt: s.issuedAt,
		keyAlgorithm: s.keyAlgorithm,
		keyFingerprint: s.keyFingerprint.toLowerCase()
	};
	if (s.keyTransitions?.length) ordered.keyTransitions = s.keyTransitions;
	ordered.signingKeyFingerprint = s.signingKeyFingerprint.toLowerCase();
	ordered.version = s.version;
	return new TextEncoder().encode(JSON.stringify(ordered));
}

export function toBase64(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

export async function signStatement(
	signer: openpgp.PrivateKey,
	s: StatementFields
): Promise<{ directoryStatementRaw: string; directorySignature: string }> {
	const raw = statementBytes(s);
	const sig = await openpgp.sign({
		message: await openpgp.createMessage({ binary: raw }),
		signingKeys: signer,
		detached: true,
		format: 'binary'
	});
	return { directoryStatementRaw: toBase64(raw), directorySignature: toBase64(sig as Uint8Array) };
}
