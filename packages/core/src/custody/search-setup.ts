import { confirmAtAuth } from '$core/custody/unlock';
import { productTarget } from '$core/products';
import { auth } from '$core/stores/session.svelte';

export function canFinishSearchSetup(): boolean {
	return productTarget('auth') !== null;
}

export function finishSearchSetup(): void {
	const accountId = auth.accountId;
	if (accountId) void confirmAtAuth(accountId);
}
