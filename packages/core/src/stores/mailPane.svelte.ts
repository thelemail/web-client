import { browser } from '$app/env';

const KEY = 'thelemail.mail.listWidth';
const PROP = '--mail-list-w';

export const LIST_MIN = 300;
export const READER_MIN = 520;

function readWidth(): number | null {
	try {
		const v = Number(localStorage.getItem(KEY));
		return Number.isFinite(v) && v >= LIST_MIN ? Math.round(v) : null;
	} catch {
		return null;
	}
}

class MailPaneStore {
	width = $state<number | null>(null);

	constructor() {
		if (!browser) return;
		this.width = readWidth();
		this.#apply(this.width);
	}

	preview(px: number) {
		this.#apply(Math.max(LIST_MIN, Math.round(px)));
	}

	set(px: number) {
		this.width = Math.max(LIST_MIN, Math.round(px));
		this.#apply(this.width);
		try {
			localStorage.setItem(KEY, String(this.width));
		} catch {
			return;
		}
	}

	reset() {
		this.width = null;
		this.#apply(null);
		try {
			localStorage.removeItem(KEY);
		} catch {
			return;
		}
	}

	#apply(px: number | null) {
		if (!browser) return;
		const root = document.documentElement.style;
		if (px === null) root.removeProperty(PROP);
		else root.setProperty(PROP, `${px}px`);
	}
}

export const mailPane = new MailPaneStore();
