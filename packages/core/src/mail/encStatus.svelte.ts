import { untrack } from 'svelte';
import { classifyAddress } from './sendDispatch';
import { lookupExternalKey } from '$core/api/externalKeys';
import { ApiCallError } from '$core/api/types';
import type { RecipientEncStatus } from './RecipientField.svelte';

type ResolvedStatus = 'checking' | 'internal' | 'encrypted' | 'cleartext' | 'failed';

export class EncStatusTracker {
	#statuses = $state<Record<string, ResolvedStatus>>({});
	#inflight = new Map<string, Promise<void>>();

	track(emails: string[]): void {
		void this.settle(emails);
	}

	settle(emails: string[]): Promise<void> {
		return untrack(() => {
			const waits: Promise<void>[] = [];
			for (const raw of emails) {
				const email = raw.toLowerCase();
				const status = this.#statuses[email];
				if (!status || status === 'failed') this.#check(email);
				const inflight = this.#inflight.get(email);
				if (inflight) waits.push(inflight);
			}
			return Promise.all(waits).then(() => undefined);
		});
	}

	#set(email: string, status: ResolvedStatus): void {
		this.#statuses = { ...this.#statuses, [email]: status };
	}

	#check(email: string): void {
		this.#set(email, 'checking');
		const run = classifyAddress(email)
			.then(async (cls) => {
				if (cls === 'internal') {
					this.#set(email, 'internal');
					return;
				}
				const t = await lookupExternalKey(email);
				this.#set(email, t.armoredKey ? 'encrypted' : 'cleartext');
			})
			.catch((e) => {
				this.#set(email, e instanceof ApiCallError && e.status === 404 ? 'cleartext' : 'failed');
			})
			.finally(() => {
				if (this.#inflight.get(email) === run) this.#inflight.delete(email);
			});
		this.#inflight.set(email, run);
	}

	statusFor(email: string): RecipientEncStatus {
		return this.#statuses[email.toLowerCase()] ?? 'checking';
	}
}
