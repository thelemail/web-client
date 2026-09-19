import { overwriteGetLocale, overwriteSetLocale } from '$paraglide/runtime.js';
import { platform } from '$platform';
import { BASE_LOCALE, isAppLocale, languageTag, matchLocale, type AppLocale } from './locales';

let current = $state<AppLocale>(BASE_LOCALE);
let explicit = $state(false);
let forced: AppLocale | null = null;

overwriteGetLocale(() => forced ?? current);
overwriteSetLocale((next) => setAppLocale(next));

function apply() {
	if (typeof document !== 'undefined') document.documentElement.lang = languageTag(current);
	platform.locale.applied?.(current);
}

async function detect(): Promise<AppLocale> {
	try {
		return matchLocale(await platform.locale.preferred()) ?? BASE_LOCALE;
	} catch {
		return BASE_LOCALE;
	}
}

export const i18n = {
	get locale(): AppLocale {
		return forced ?? current;
	},
	get explicit(): boolean {
		return explicit;
	},
	get tag(): string {
		return languageTag(forced ?? current);
	}
};

export function withLocale<T>(locale: AppLocale, fn: () => T): T {
	const previous = forced;
	forced = locale;
	try {
		return fn();
	} finally {
		forced = previous;
	}
}

export async function initLocale(): Promise<void> {
	const saved = platform.locale.saved();
	if (isAppLocale(saved)) {
		current = saved;
		explicit = true;
	} else {
		current = await detect();
		explicit = false;
	}
	apply();
}

export function setAppLocale(next: AppLocale): void {
	current = next;
	explicit = true;
	platform.locale.save(next);
	apply();
}

export async function followSystemLocale(): Promise<void> {
	platform.locale.save(null);
	explicit = false;
	current = await detect();
	apply();
}
