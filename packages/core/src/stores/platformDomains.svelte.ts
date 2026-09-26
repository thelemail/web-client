import { getPlatformDomains } from '$core/api/auth';
import { getLocale } from '$paraglide/runtime.js';

export function domainOf(email: string): string {
	const at = email.lastIndexOf('@');
	return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase();
}

export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction'): string {
	try {
		return new Intl.ListFormat(getLocale(), { type }).format(items);
	} catch {
		return items.join(', ');
	}
}

export function isPlatformAddress(email: string, domains: readonly string[]): boolean {
	const domain = domainOf(email);
	return domain !== '' && domains.includes(domain);
}

const RETRY_AFTER_MS = 5000;

class PlatformDomainsStore {
	#domains = $state<string[]>([]);
	#default = $state('');
	#inflight: Promise<void> | null = null;
	#failedAt = 0;

	get list(): string[] {
		this.#ensure();
		return this.#domains;
	}

	get default(): string {
		this.#ensure();
		return this.#default;
	}

	get loaded(): boolean {
		this.#ensure();
		return this.#domains.length > 0;
	}

	includes(domain: string): boolean {
		return this.list.includes(domain.trim().toLowerCase());
	}

	isPlatformAddress(email: string): boolean {
		return isPlatformAddress(email, this.list);
	}

	addressesFor(handle: string, primary: string): string[] {
		return [primary, ...this.list.filter((d) => d !== primary)].map((d) => `${handle}@${d}`);
	}

	display(type: 'conjunction' | 'disjunction' = 'disjunction'): string {
		return formatList(this.list, type);
	}

	load(): Promise<void> {
		if (this.#domains.length > 0) return Promise.resolve();
		this.#inflight ??= getPlatformDomains()
			.then((res) => {
				const domains = res.domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
				this.#domains = domains;
				this.#default = domains.includes(res.default) ? res.default : (domains[0] ?? '');
			})
			.catch((err) => {
				this.#failedAt = Date.now();
				throw err;
			})
			.finally(() => {
				this.#inflight = null;
			});
		return this.#inflight;
	}

	#ensure(): void {
		if (this.#domains.length === 0 && !this.#inflight && Date.now() - this.#failedAt > RETRY_AFTER_MS) {
			this.load().catch(() => {});
		}
	}
}

export const platformDomains = new PlatformDomainsStore();
