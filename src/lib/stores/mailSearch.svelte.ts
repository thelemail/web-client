class MailSearchStore {
	text = $state('');

	clear() {
		this.text = '';
	}
}

export const mailSearch = new MailSearchStore();
