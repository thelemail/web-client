export interface SettingsCrumb {
	label: string;
	href: string;
}

class SettingsPageTitleStore {
	value = $state<string | null>(null);
	crumb = $state<SettingsCrumb | null>(null);
	mono = $state(false);

	set = (next: string | null): void => {
		this.value = next;
		this.crumb = null;
		this.mono = false;
	};

	setTrail = (crumb: SettingsCrumb, title: string, mono = false): void => {
		this.value = title;
		this.crumb = crumb;
		this.mono = mono;
	};
}

export const settingsPageTitle = new SettingsPageTitleStore();
