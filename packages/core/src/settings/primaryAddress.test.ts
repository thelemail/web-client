import { afterEach, describe, expect, it, vi } from 'vitest';
import { addresses } from '$core/stores/addresses.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
import { makePrimary } from './primaryAddress';

afterEach(() => vi.restoreAllMocks());

describe('makePrimary', () => {
	it('sets the primary and refreshes both address lists', async () => {
		const setPrimary = vi.spyOn(addresses, 'setPrimary').mockResolvedValue();
		const load = vi.spyOn(addresses, 'load').mockResolvedValue();
		const reload = vi.spyOn(workspaceAddresses, 'reload').mockResolvedValue();
		await makePrimary('a1');
		expect(setPrimary).toHaveBeenCalledWith('a1');
		expect(load).toHaveBeenCalledOnce();
		expect(reload).toHaveBeenCalledOnce();
	});

	it('fails without refreshing when the server refuses', async () => {
		vi.spyOn(addresses, 'setPrimary').mockRejectedValue(new Error('409'));
		const load = vi.spyOn(addresses, 'load').mockResolvedValue();
		const reload = vi.spyOn(workspaceAddresses, 'reload').mockResolvedValue();
		await expect(makePrimary('a1')).rejects.toThrow('409');
		expect(load).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});

	it('still succeeds when a refresh fails after the change landed', async () => {
		vi.spyOn(addresses, 'setPrimary').mockResolvedValue();
		vi.spyOn(addresses, 'load').mockRejectedValue(new Error('offline'));
		vi.spyOn(workspaceAddresses, 'reload').mockResolvedValue();
		await expect(makePrimary('a1')).resolves.toBeUndefined();
	});
});
