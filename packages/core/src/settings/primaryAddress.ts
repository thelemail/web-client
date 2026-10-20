import { addresses } from '$core/stores/addresses.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';

export async function makePrimary(id: string): Promise<void> {
	await addresses.setPrimary(id);
	await Promise.allSettled([addresses.load(), workspaceAddresses.reload()]);
}
