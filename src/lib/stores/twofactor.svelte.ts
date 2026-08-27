import { getTwoFactorStatus } from '$lib/api/twofactor';
import type { TwoFactorStatus } from '$lib/api/types';

class TwoFactorStore {
	status = $state<TwoFactorStatus | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);

	enabled = $derived(this.status?.enabled === true);

	async load(accountId?: string): Promise<void> {
		if (this.loading) return;
		this.loading = true;
		this.error = null;
		try {
			this.status = await getTwoFactorStatus(accountId);
		} catch (err) {
			console.warn('twofactor: status load failed', err);
			this.error = err instanceof Error ? err.message : 'Failed to load two-factor status';
		} finally {
			this.loading = false;
		}
	}

	invalidate(): void {
		this.status = null;
	}

	setAccount(accountId: string | null): void {
		void accountId;
		this.status = null;
		this.error = null;
		this.loading = false;
	}
}

export const twofactor = new TwoFactorStore();
