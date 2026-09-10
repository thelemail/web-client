import { browser } from '$app/environment';

export type ThemePref = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'thelemail.theme';

export const THEME_META: Record<ThemePref, { label: string }> = {
	light: { label: 'Parchment' },
	dark: { label: 'Inkwell' },
	auto: { label: 'Auto' }
};

const THEME_CYCLE: Record<ThemePref, ThemePref> = {
	light: 'dark',
	dark: 'auto',
	auto: 'light'
};

function readPref(): ThemePref {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'dark' || v === 'auto' || v === 'light' ? v : 'light';
	} catch {
		return 'light';
	}
}

class ThemeStore {
	pref = $state<ThemePref>('light');
	resolved = $state<ResolvedTheme>('light');
	#mq: MediaQueryList | null = null;

	constructor() {
		if (!browser) return;
		this.#mq = window.matchMedia('(prefers-color-scheme: dark)');
		this.pref = readPref();
		this.#apply();
		this.#mq.addEventListener('change', () => {
			if (this.pref === 'auto') this.#apply();
		});
	}

	set(pref: ThemePref) {
		this.pref = pref === 'dark' || pref === 'auto' ? pref : 'light';
		this.#apply();
		try {
			localStorage.setItem(KEY, this.pref);
		} catch {
			return;
		}
	}

	cycle() {
		this.set(THEME_CYCLE[this.pref]);
	}

	get label(): string {
		return THEME_META[this.pref].label;
	}

	#apply() {
		this.resolved =
			this.pref === 'auto' ? (this.#mq?.matches ? 'dark' : 'light') : this.pref;
		document.documentElement.setAttribute('data-theme', this.resolved);
		document.documentElement.setAttribute('data-theme-pref', this.pref);
	}
}

export const theme = new ThemeStore();
