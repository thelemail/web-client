import { ApiCallError } from '$core/api/types';

export function isReauthenticationRequired(err: unknown): boolean {
	return err instanceof ApiCallError && err.envelope?.error?.code === 'reauthentication_required';
}

interface Prompt {
	accountId: string;
	promise: Promise<boolean>;
	resolve: (ok: boolean) => void;
}

class ReauthPrompt {
	accountId = $state<string | null>(null);
	#current: Prompt | null = null;

	async request(accountId: string): Promise<boolean> {
		while (this.#current && this.#current.accountId !== accountId) {
			await this.#current.promise;
		}
		if (this.#current) return this.#current.promise;
		let resolve!: (ok: boolean) => void;
		const promise = new Promise<boolean>((r) => {
			resolve = r;
		});
		this.#current = { accountId, promise, resolve };
		this.accountId = accountId;
		return promise;
	}

	settle(ok: boolean): void {
		const current = this.#current;
		if (!current) return;
		this.#current = null;
		this.accountId = null;
		current.resolve(ok);
	}
}

export const reauth = new ReauthPrompt();
