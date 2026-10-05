import { tick } from 'svelte';

class MailNavStore {
	open = $state(false);
	#opener: HTMLElement | null = null;

	toggle(opener?: EventTarget | null): void {
		if (this.open) {
			this.close();
			return;
		}
		this.#opener = opener instanceof HTMLElement ? opener : null;
		this.open = true;
	}

	close(restoreFocus = false): void {
		if (!this.open) return;
		this.open = false;
		const opener = this.#opener;
		this.#opener = null;
		if (!restoreFocus || !opener) return;
		void tick().then(() => {
			if (opener.isConnected) opener.focus();
		});
	}
}

export const mailNav = new MailNavStore();
