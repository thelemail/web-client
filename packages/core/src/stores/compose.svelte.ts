import { browser } from '$app/env';

const EXPANDED_KEY = 'thelemail.compose.expanded';

export interface ForwardRef {
	source: string;
	seed: string;
}

export interface ComposeSession {
	key: string;
	draftId: string | null;
	forward: ForwardRef | null;
	returnFocus: HTMLElement | null;
}

function readExpanded(): boolean {
	try {
		return localStorage.getItem(EXPANDED_KEY) === '1';
	} catch {
		return false;
	}
}

function activeElement(): HTMLElement | null {
	if (!browser) return null;
	const el = document.activeElement;
	return el instanceof HTMLElement && el !== document.body ? el : null;
}

class ComposeStore {
	sessions = $state<ComposeSession[]>([]);
	focused = $state<string | null>(null);
	expanded = $state(false);
	#accountId: string | null = null;
	#seq = 0;

	constructor() {
		if (browser) this.expanded = readExpanded();
	}

	get open(): boolean {
		return this.sessions.length > 0;
	}

	get active(): ComposeSession | null {
		return this.sessions.find((s) => s.key === this.focused) ?? null;
	}

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.sessions = [];
		this.focused = null;
	}

	openNew(): string {
		return this.#add({ draftId: null, forward: null });
	}

	openDraft(id: string): string {
		const existing = this.sessions.find((s) => s.draftId === id);
		if (existing) {
			this.focus(existing.key);
			return existing.key;
		}
		return this.#add({ draftId: id, forward: null });
	}

	openForward(ref: ForwardRef): string {
		const existing = this.sessions.find(
			(s) => s.forward?.source === ref.source && s.forward.seed === ref.seed
		);
		if (existing) {
			this.focus(existing.key);
			return existing.key;
		}
		return this.#add({ draftId: null, forward: ref });
	}

	bindDraft(key: string, draftId: string): void {
		const s = this.sessions.find((x) => x.key === key);
		if (s && s.draftId !== draftId) s.draftId = draftId;
	}

	isOpen(draftId: string): boolean {
		return this.sessions.some((s) => s.draftId === draftId);
	}

	focus(key: string): void {
		if (this.sessions.some((s) => s.key === key)) this.focused = key;
	}

	minimize(key: string): void {
		if (this.focused === key) this.focused = null;
	}

	close(key: string): ComposeSession | null {
		const s = this.sessions.find((x) => x.key === key) ?? null;
		this.sessions = this.sessions.filter((x) => x.key !== key);
		if (this.focused === key) this.focused = null;
		return s;
	}

	closeDraft(draftId: string): void {
		const s = this.sessions.find((x) => x.draftId === draftId);
		if (s) this.close(s.key);
	}

	setExpanded(next: boolean): void {
		this.expanded = next;
		try {
			if (next) localStorage.setItem(EXPANDED_KEY, '1');
			else localStorage.removeItem(EXPANDED_KEY);
		} catch {
			return;
		}
	}

	#add(init: Pick<ComposeSession, 'draftId' | 'forward'>): string {
		this.#seq += 1;
		const key = `c${this.#seq}`;
		this.sessions = [...this.sessions, { key, ...init, returnFocus: activeElement() }];
		this.focused = key;
		return key;
	}
}

export const composeStore = new ComposeStore();
