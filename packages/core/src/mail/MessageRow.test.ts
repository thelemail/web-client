import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$core/stores/personAvatars.svelte', () => ({
	personAvatars: { avatarUrl: (address?: string) => (address ? `https://avatars.test/${address}` : null) }
}));

vi.mock('$core/stores/bimi.svelte', () => ({
	bimi: { logoUrl: (domain?: string) => (domain ? `https://bimi.test/${domain}` : null) }
}));

import MessageRow from './MessageRow.svelte';
import { mailActionsFor } from './actions';
import type { Message } from './data';

function message(overrides: Partial<Message> = {}): Message {
	return {
		id: 'm1',
		folder: 'inbox',
		direction: 'received',
		from: 'Chief Executive',
		fromAddr: 'ceo@acme.test',
		bimiDomain: 'acme.test',
		to: 'me@acme.test',
		init: 'CE',
		bg: '#fff',
		fg: '#000',
		subj: 'Wire transfer',
		labels: [],
		unread: false,
		starred: false,
		prev: 'today please',
		body: [],
		epoch: 1_700_000_000_000,
		...overrides
	};
}

function mount(m: Message) {
	return render(MessageRow, {
		props: {
			m,
			active: false,
			checked: false,
			anyChecked: false,
			caps: mailActionsFor('inbox'),
			viewFolder: 'inbox',
			onOpen: () => {},
			onToggleStar: () => {},
			onToggleCheck: () => {},
			onArchive: () => {},
			onTrash: () => {},
			onToggleRead: () => {}
		}
	});
}

describe('MessageRow sender', () => {
	it('shows the sender photo for an ordinary row', () => {
		const { container } = mount(message());
		expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.test/ceo@acme.test');
		expect(container.querySelector('.tick.forged')).toBeNull();
	});

	it('drops every image and marks a row whose sender is forged', () => {
		const { container } = mount(
			message({ from: 'mallory@acme.test', fromAddr: 'mallory@acme.test', init: 'MA', senderMismatch: true })
		);
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.from')?.textContent).toBe('mallory@acme.test');
		expect(container.querySelector('.tick.forged')?.getAttribute('title')).toBe('Sender address forged');
		expect(container.querySelector('.sr-only')?.textContent).toContain('Sender address forged');
	});
});
