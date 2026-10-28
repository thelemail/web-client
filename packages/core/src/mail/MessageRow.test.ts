import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$core/stores/personAvatars.svelte', () => ({
	personAvatars: { avatarUrl: (address?: string) => (address ? `https://avatars.test/${address}` : null) }
}));

vi.mock('$core/stores/bimi.svelte', () => ({
	bimi: { logoUrl: (domain?: string) => (domain ? `https://bimi.test/${domain}` : null) }
}));

const L = {
	a: '0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0001',
	b: '0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0002',
	c: '0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0003',
	d: '0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0004',
};

const LABELS: Record<string, { name: string }> = {
	'0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0001': { name: 'Clients' },
	'0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0002': { name: 'Finance' },
	'0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0003': { name: 'Travel' },
	'0b6f1a52-6c1e-4a57-9a0e-1d1c4f0a0004': { name: 'Zeta' }
};

vi.mock('$core/stores/mailCollections.svelte', () => ({
	mailCollections: {
		label: (id: string) =>
			LABELS[id]
				? { id, name: LABELS[id].name, path: LABELS[id].name, color: null, sealed: false, depth: 0, parentId: null }
				: undefined
	}
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

function mount(m: Message, state: { active?: boolean; checked?: boolean; viewFolder?: string } = {}) {
	return render(MessageRow, {
		props: {
			m,
			active: state.active ?? false,
			checked: state.checked ?? false,
			anyChecked: state.checked ?? false,
			caps: mailActionsFor('inbox'),
			viewFolder: state.viewFolder ?? 'inbox',
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

describe('MessageRow hierarchy', () => {
	it('puts sender, subject and preview on their own lines and reads them in that order', () => {
		const { container } = mount(message());
		expect(container.querySelector('.r1 .from')?.textContent).toBe('Chief Executive');
		expect(container.querySelector('.r2 .stxt')?.textContent).toBe('Wire transfer');
		expect(container.querySelector('.r2 .prev')).toBeNull();
		expect(container.querySelector('.r3 .prev')?.textContent).toBe('today please');
		const open = container.querySelector('.mrow-open')!;
		const ids = open.getAttribute('aria-labelledby')!.split(' ');
		expect(ids.map((id) => container.querySelector(`[id="${id}"]`)?.className)).toEqual([
			'sr-only',
			'from',
			'stxt'
		]);
		expect(open.getAttribute('aria-describedby')!.split(' ').at(-1)).toBe(
			container.querySelector('.prev')!.id
		);
	});

	it('keeps attachment, invitation and thread markers on the sender line', () => {
		const { container } = mount(
			message({
				threadCount: 3,
				event: {} as Message['event'],
				attachments: [
					{ name: 'plan.pdf' },
					{ name: 'invite.ics' }
				] as Message['attachments']
			})
		);
		expect(container.querySelector('.r1 .thr-ct')?.textContent?.trim()).toBe('3');
		expect(container.querySelector('.r1 .tick[title="Invitation"]')).not.toBeNull();
		const clip = [...container.querySelectorAll('.r1 .tick')].find((t) => t.textContent?.trim() === '1');
		expect(clip).toBeDefined();
	});

	it('marks a snoozed row with a clock as well as the wake time', () => {
		const wake = new Date(Date.now() + 86_400_000).toISOString();
		const { container } = mount(message({ folder: 'snoozed', snoozedUntil: wake }), { viewFolder: 'snoozed' });
		const time = container.querySelector('.r1 .time.wake')!;
		expect(time.querySelector('svg')).not.toBeNull();
		expect(time.getAttribute('title')).toMatch(/^Comes back /);
	});
});

describe('MessageRow labels', () => {
	it('shows two labels and folds the rest into +N with their names', () => {
		const { container } = mount(message({ labels: [L.d, L.b, L.a, L.c] }));
		const chips = [...container.querySelectorAll('.r3 .lchip')].map((c) => c.textContent?.trim());
		expect(chips).toEqual(['Clients', 'Finance']);
		const more = container.querySelector('.r3 .lchip-more')!;
		expect(more.querySelector('[aria-hidden="true"]')?.textContent).toBe('+2');
		expect(more.getAttribute('title')).toBe('Travel, Zeta');
		expect(more.querySelector('.sr-only')?.textContent?.trim()).toBe('Also labeled Travel, Zeta');
	});

	it('leaves out the label being viewed', () => {
		const { container } = mount(message({ labels: [L.a, L.b, L.c] }), { viewFolder: `l-${L.a}` });
		const chips = [...container.querySelectorAll('.r3 .lchip')].map((c) => c.textContent?.trim());
		expect(chips).toEqual(['Finance', 'Travel']);
		expect(container.querySelector('.lchip-more')).toBeNull();
	});
});

describe('MessageRow states', () => {
	it('gives each state its own marker', () => {
		const plain = mount(message()).container;
		expect(plain.querySelector('.mrow')?.className).not.toMatch(/unread|active|sel/);
		expect(plain.querySelector('.mrow-open')?.hasAttribute('aria-current')).toBe(false);

		const unread = mount(message({ unread: true })).container;
		expect(unread.querySelector('.mrow.unread')).not.toBeNull();
		expect(unread.querySelector('.sr-only')?.textContent).toContain('Unread');

		const opened = mount(message(), { active: true }).container;
		expect(opened.querySelector('.mrow.active')).not.toBeNull();
		expect(opened.querySelector('.mrow-open')?.getAttribute('aria-current')).toBe('true');

		const checked = mount(message(), { checked: true }).container;
		expect(checked.querySelector('.mrow.sel.checking')).not.toBeNull();
		expect(checked.querySelector('.row-ck.on')?.getAttribute('aria-pressed')).toBe('true');
	});

	it('keeps combined states independent', () => {
		const { container } = mount(message({ unread: true }), { active: true, checked: true });
		const row = container.querySelector('.mrow')!;
		expect(row.classList.contains('unread')).toBe(true);
		expect(row.classList.contains('active')).toBe(true);
		expect(row.classList.contains('sel')).toBe(true);
	});
});
