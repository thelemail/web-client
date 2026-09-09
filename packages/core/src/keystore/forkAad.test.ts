import { describe, expect, it } from 'vitest';

const AAD = (product: string, accountId: string) => new TextEncoder().encode(`${product}:${accountId}`);

async function seal(product: string, accountId: string, body: string) {
	const raw = crypto.getRandomValues(new Uint8Array(32));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData: AAD(product, accountId) },
			key,
			new TextEncoder().encode(body)
		)
	);
	return { raw, iv, ct };
}

async function open(sealed: Awaited<ReturnType<typeof seal>>, product: string, accountId: string) {
	const key = await crypto.subtle.importKey('raw', sealed.raw, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: sealed.iv, additionalData: AAD(product, accountId) },
		key,
		sealed.ct
	);
	return new TextDecoder().decode(pt);
}

const A = 'ea2d5f2c-e0dd-4b86-b01e-93f72f643ee6';
const B = '11111111-2222-3333-4444-555555555555';

describe('fork payload binding', () => {
	it('opens for the account and product it was sealed for', async () => {
		const sealed = await seal('calendar', A, 'keys');
		await expect(open(sealed, 'calendar', A)).resolves.toBe('keys');
	});

	it('cannot be replayed against a different account', async () => {
		const sealed = await seal('calendar', A, 'keys');
		await expect(open(sealed, 'calendar', B)).rejects.toBeTruthy();
	});

	it('cannot be replayed against a different product', async () => {
		const sealed = await seal('calendar', A, 'keys');
		await expect(open(sealed, 'drive', A)).rejects.toBeTruthy();
	});
});
