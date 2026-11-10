// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	getCryptoState: vi.fn(),
	getProductCandidate: vi.fn(),
	putSecretBundle: vi.fn(),
	putProductBundle: vi.fn(),
	putProductManifest: vi.fn(),
	activateCryptoHead: vi.fn(),
	getProductBundle: vi.fn(),
	getProductKeys: vi.fn(),
	getSecretBundle: vi.fn()
}));
const keystore = vi.hoisted(() => ({ prepareProductKeys: vi.fn(), readProductKeys: vi.fn() }));
vi.mock('$core/api/productKeys', () => api);
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));
vi.mock('$core/api/me', () => ({ listMyKeys: vi.fn(async () => ({ keys: [] })) }));
vi.mock('$core/api/aliases', () => ({ listMyAliasKeys: vi.fn(async () => ({ keys: [] })) }));

import { ApiCallError } from '$core/api/types';
import { ensureConverted } from './product-keys';

const accountId = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';

function state(over: Record<string, unknown>) {
	return {
		features: { productKeys: true },
		head: null,
		scope: { keyHistoryRoot: '' },
		sessionEpoch: 1,
		credentials: [],
		slots: [],
		keys: [],
		bundles: [],
		history: { events: [], nextCursor: null },
		...over
	};
}

beforeEach(() => {
	for (const fn of [...Object.values(api), ...Object.values(keystore)]) fn.mockReset();
	api.getProductCandidate.mockRejectedValue(new ApiCallError(404, null, 'not found'));
});

describe('ensureConverted', () => {
	it('reports an account as not ready while product keys are off', async () => {
		api.getCryptoState.mockResolvedValue(state({ features: { productKeys: false } }));
		expect(await ensureConverted(accountId)).toBe(false);
		expect(keystore.prepareProductKeys).not.toHaveBeenCalled();
	});

	it('leaves an account that already has the new head alone', async () => {
		api.getCryptoState.mockResolvedValue(state({ head: { version: 2 } }));
		expect(await ensureConverted(accountId)).toBe(true);
		expect(keystore.prepareProductKeys).not.toHaveBeenCalled();
		expect(api.activateCryptoHead).not.toHaveBeenCalled();
	});

	it('starts the conversion for an account without the new head and writes nothing when the vault refuses', async () => {
		api.getCryptoState.mockResolvedValue(state({}));
		keystore.prepareProductKeys.mockResolvedValue({ ok: false, code: 'locked' });
		expect(await ensureConverted(accountId)).toBe(false);
		expect(keystore.prepareProductKeys).toHaveBeenCalledTimes(1);
		expect(keystore.prepareProductKeys.mock.calls[0][0].accountId).toBe(accountId);
		expect(api.putSecretBundle).not.toHaveBeenCalled();
		expect(api.activateCryptoHead).not.toHaveBeenCalled();
	});
});
