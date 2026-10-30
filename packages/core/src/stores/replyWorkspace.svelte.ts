import { browser } from '$app/env';

const PANE_KEY = 'thelemail.reply.pane';

function readPane(): boolean {
	try {
		return localStorage.getItem(PANE_KEY) !== '0';
	} catch {
		return true;
	}
}

class ReplyWorkspace {
	expanded = $state(false);
	pane = $state(true);

	constructor() {
		if (browser) this.pane = readPane();
	}

	setExpanded(next: boolean): void {
		this.expanded = next;
	}

	setPane(next: boolean): void {
		this.pane = next;
		try {
			if (next) localStorage.removeItem(PANE_KEY);
			else localStorage.setItem(PANE_KEY, '0');
		} catch {
			return;
		}
	}
}

export const replyWorkspace = new ReplyWorkspace();
