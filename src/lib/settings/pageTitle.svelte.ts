class SettingsPageTitleStore {
	value = $state<string | null>(null);

	set = (next: string | null): void => {
		this.value = next;
	};
}

export const settingsPageTitle = new SettingsPageTitleStore();
