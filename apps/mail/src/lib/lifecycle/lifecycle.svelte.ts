import type { LifecycleInfo } from '$lib/api/types';
import { auth } from '$lib/stores/auth.svelte';
import { billing } from '$lib/stores/billing.svelte';
import { buildContextFromServer, contextDefaults, deriveStage } from './context';
import type { LifecycleContext, LifecycleStage } from './types';

class LifecycleStore {
	#accountId: string | null = null;
	#restoreOrigin = $state<LifecycleStage | null>(null);

	setAccount(accountId: string | null): void {
		this.#accountId = accountId;
	}

	#info(): LifecycleInfo | null {
		return auth.lifecycleFor(this.#accountId ?? '');
	}

	get stage(): LifecycleStage {
		return deriveStage(this.#info());
	}

	get readOnly(): boolean {
		return this.stage === 'grace';
	}

	get showBanner(): boolean {
		return this.stage === 'grace';
	}

	markRestoreOrigin(origin: LifecycleStage): void {
		this.#restoreOrigin = origin;
	}

	get context(): LifecycleContext {
		const email = auth.email ?? contextDefaults.email;
		return buildContextFromServer({
			info: this.#info(),
			sub: billing.subscription,
			email,
			restoreOrigin: this.#restoreOrigin
		});
	}
}

export const lifecycle = new LifecycleStore();
