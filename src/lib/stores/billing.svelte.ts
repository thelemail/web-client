import { browser } from '$app/environment';
import {
	getMySubscription,
	getPlans,
	type PlanCatalog,
	type Subscription
} from '$lib/api/billing';

class BillingStore {
	subscription = $state<Subscription | null>(null);
	catalog = $state<PlanCatalog | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#loadedFor: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.#loadedFor = null;
		this.subscription = null;
		this.error = null;
	}

	needsPayment = $derived.by(() => {
		const sub = this.subscription;
		if (!sub) return false;
		return !sub.entitled;
	});

	async ensureLoaded(): Promise<Subscription | null> {
		if (!browser) return null;
		const acct = this.#accountId;
		if (acct && this.#loadedFor === acct && this.subscription) return this.subscription;
		return this.refresh();
	}

	async refresh(): Promise<Subscription | null> {
		if (!browser) return null;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const sub = await getMySubscription();
			if (this.#accountId !== acct) return null;
			this.subscription = sub;
			this.#loadedFor = acct;
			return sub;
		} catch (err) {
			if (this.#accountId !== acct) return null;
			this.error = err instanceof Error ? err.message : 'failed to load subscription';
			return null;
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async ensureCatalog(): Promise<PlanCatalog | null> {
		if (!browser) return null;
		if (this.catalog) return this.catalog;
		try {
			this.catalog = await getPlans();
			return this.catalog;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'failed to load plans';
			return null;
		}
	}
}

export const billing = new BillingStore();
