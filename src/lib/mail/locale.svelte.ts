export type DateFormat = 'dmy' | 'mdy' | 'iso';
export type TimeFormat = '24' | '12';

export interface LocaleSettings {
	dateFormat: DateFormat;
	timeFormat: TimeFormat;
}

export const LOCALE_DEFAULTS: LocaleSettings = {
	dateFormat: 'dmy',
	timeFormat: '24'
};

class LocaleStore {
	dateFormat = $state<DateFormat>(LOCALE_DEFAULTS.dateFormat);
	timeFormat = $state<TimeFormat>(LOCALE_DEFAULTS.timeFormat);

	get timeZone(): string {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	get value(): LocaleSettings {
		return { dateFormat: this.dateFormat, timeFormat: this.timeFormat };
	}

	set(value: LocaleSettings): void {
		this.dateFormat = value.dateFormat;
		this.timeFormat = value.timeFormat;
	}

	reset(): void {
		this.dateFormat = LOCALE_DEFAULTS.dateFormat;
		this.timeFormat = LOCALE_DEFAULTS.timeFormat;
	}
}

export const locale = new LocaleStore();
