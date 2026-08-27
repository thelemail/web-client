class ComposeStore {
	open = $state(false);
	editingDraftId = $state<string | null>(null);
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.open = false;
		this.editingDraftId = null;
	}

	openNew(): void {
		this.editingDraftId = null;
		this.open = true;
	}

	openDraft(id: string): void {
		this.editingDraftId = id;
		this.open = true;
	}

	close(): void {
		this.open = false;
		this.editingDraftId = null;
	}
}

export const composeStore = new ComposeStore();
