import { getTwoFactorStatus } from '$core/api/twofactor';
import type { TwoFactorStatus } from '$core/api/types';

export type TwoFactorPhase = 'unknown' | 'loading' | 'error' | 'ready';

class TwoFactorStore {
	status = $state<TwoFactorStatus | null>(null);
	phase = $state<TwoFactorPhase>('unknown');

	enabled = $derived(this.status?.enabled === true);
	loading = $derived(this.phase === 'loading');

	#accountId: string | null = null;
	#seq = 0;

	ensure(accountId?: string | null): void {
		if (this.phase === 'unknown') void this.load(accountId);
	}

	async load(accountId?: string | null): Promise<void> {
		const seq = ++this.#seq;
		this.phase = 'loading';
		try {
			const status = await getTwoFactorStatus(accountId ?? this.#accountId ?? undefined);
			if (seq !== this.#seq) return;
			this.status = status;
			this.phase = 'ready';
		} catch (err) {
			if (seq !== this.#seq) return;
			console.warn('twofactor: status load failed', err);
			this.phase = 'error';
		}
	}

	setAccount(accountId: string | null): void {
		this.#accountId = accountId;
		this.#seq++;
		this.status = null;
		this.phase = 'unknown';
	}
}

export const twofactor = new TwoFactorStore();
