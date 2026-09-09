import { classifyAddress } from './sendDispatch';
import { lookupExternalKey } from '$lib/api/externalKeys';
import { ApiCallError } from '$lib/api/types';
import type { RecipientEncStatus } from './RecipientField.svelte';

type ResolvedStatus = 'checking' | 'internal' | 'encrypted' | 'cleartext';

export class EncStatusTracker {
	#statuses = $state<Record<string, ResolvedStatus>>({});

	track(emails: string[]): void {
		for (const raw of emails) {
			const email = raw.toLowerCase();
			if (this.#statuses[email]) continue;
			this.#statuses = { ...this.#statuses, [email]: 'checking' };
			void classifyAddress(email)
				.then((cls) => {
					if (cls === 'internal') {
						this.#statuses = { ...this.#statuses, [email]: 'internal' };
						return;
					}
					return lookupExternalKey(email).then((t) => {
						this.#statuses = {
							...this.#statuses,
							[email]: t.armoredKey ? 'encrypted' : 'cleartext'
						};
					});
				})
				.catch((e) => {
					if (e instanceof ApiCallError && e.status === 404) {
						this.#statuses = { ...this.#statuses, [email]: 'cleartext' };
					}
				});
		}
	}

	statusFor(email: string): RecipientEncStatus {
		return this.#statuses[email.toLowerCase()] ?? 'checking';
	}
}
