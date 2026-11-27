// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from '../../interop/vectors/secret-wrap-v2.json?raw';
import { decodeCanonical, encodeCanonical, utf8 } from '../productkeys/canonical';
import { b64decode, b64encode, sha256 } from '../productkeys/encoding';
import { deriveSecret } from '../productkeys/envelope';
import { ProductKeysError } from '../productkeys/errors';
import type { Bundle, Slot, SlotPurpose } from './secretwrap';
import { label, openBundle, openSlot, sealBundle, sealSlot } from './secretwrap';

const DIGEST = 'd330b770ee0c7ef7575364ca9a5e038fc243ecf6580ad7812a153470f41adf3e';

interface Context {
	purpose: string;
	accountId: string;
	amkEpoch: number;
	revision: number;
	slotId?: string;
	credentialId?: string;
	credentialGeneration?: number;
	credentialConfigDigest?: string;
	createdAuthEpoch?: number;
	bundleId?: string;
}

interface Case {
	name: string;
	variant: 'slot' | 'bundle';
	ikm: string;
	context: Context;
	wrapper: string;
	aad?: string;
	key?: string;
	plaintext?: string;
	error?: string;
}

const file = JSON.parse(raw) as { cases: Case[] };

function slotOf(c: Context): Slot {
	return {
		purpose: c.purpose as SlotPurpose,
		accountId: c.accountId,
		amkEpoch: c.amkEpoch,
		revision: c.revision,
		slotId: c.slotId ?? '',
		credentialId: c.credentialId ?? '',
		credentialGeneration: c.credentialGeneration ?? 0,
		credentialConfigDigest: b64decode(c.credentialConfigDigest ?? ''),
		createdAuthEpoch: c.createdAuthEpoch ?? 0
	};
}

function bundleOf(c: Context): Bundle {
	return { accountId: c.accountId, amkEpoch: c.amkEpoch, bundleId: c.bundleId ?? '', revision: c.revision };
}

async function run(c: Case): Promise<Uint8Array> {
	const ikm = b64decode(c.ikm);
	const wrapper = utf8(c.wrapper);
	return c.variant === 'slot' ? openSlot(ikm, wrapper, slotOf(c.context)) : openBundle(ikm, wrapper, bundleOf(c.context));
}

describe('secret-wrap-v2 vectors', () => {
	it('pins the file digest', async () => {
		const sum = await sha256(utf8(raw));
		expect(Array.from(sum, (x) => x.toString(16).padStart(2, '0')).join('')).toBe(DIGEST);
	});

	it('covers every outcome', () => {
		const codes = new Set(file.cases.map((c) => c.error ?? ''));
		for (const code of ['', 'malformed', 'purpose', 'context', 'decrypt']) expect(codes).toContain(code);
	});

	for (const c of file.cases.filter((c) => !c.error)) {
		it(`opens and reseals ${c.name}`, async () => {
			const plain = await run(c);
			expect(b64encode(plain)).toBe(c.plaintext ?? '');
			const w = decodeCanonical(utf8(c.wrapper), 1 << 20);
			const params = { salt: b64decode(w.salt), nonce: b64decode(w.nonce) };
			const ikm = b64decode(c.ikm);
			const sealed =
				c.variant === 'slot'
					? await sealSlot(ikm, slotOf(c.context), plain, params)
					: await sealBundle(ikm, bundleOf(c.context), plain, params);
			expect(new TextDecoder().decode(sealed)).toBe(c.wrapper);
			const { ciphertext: _ct, ...fields } = w;
			const aad = encodeCanonical(fields);
			expect(new TextDecoder().decode(aad)).toBe(c.aad);
			const key = await deriveSecret(ikm, params.salt, label(c.context.purpose), aad);
			expect(b64encode(key)).toBe(c.key);
		});
	}

	for (const c of file.cases.filter((c) => c.error)) {
		it(`rejects ${c.name} as ${c.error}`, async () => {
			const err = await run(c).then(
				() => null,
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(ProductKeysError);
			expect((err as ProductKeysError).code).toBe(c.error);
		});
	}
});
