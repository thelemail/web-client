import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: {
		objectUrl: (key: string) => `blob:${key}`,
		ensureObjectUrl: vi.fn()
	}
}));

const { default: SignatureEditor } = await import('./SignatureEditor.svelte');

afterEach(() => cleanup());

function placeholder(mode: 'markdown' | 'html', name: string | null) {
	render(SignatureEditor, {
		props: { addressId: 'a1', name, email: 'grace@acme.test', mode, source: '', bodyHtml: '', onChange: vi.fn() }
	});
	return document.querySelector('textarea')?.getAttribute('placeholder') ?? '';
}

describe('SignatureEditor source placeholder', () => {
	it('shows the sender in Markdown', () => {
		expect(placeholder('markdown', 'Grace Hopper')).toBe('**Grace Hopper**\n[grace@acme.test](mailto:grace@acme.test)');
	});

	it('shows the sender in HTML', () => {
		expect(placeholder('html', 'Grace Hopper')).toBe(
			'<p><strong>Grace Hopper</strong><br><a href="mailto:grace@acme.test">grace@acme.test</a></p>'
		);
	});

	it.each(['markdown', 'html'] as const)('falls back to the address alone in %s without a name', (mode) => {
		const text = placeholder(mode, '  ');
		expect(text).toContain('grace@acme.test');
		expect(text).not.toMatch(/\*\*|<strong>|undefined|null/);
	});

	it('carries no sample persona', () => {
		expect(placeholder('markdown', null)).not.toMatch(/Ada|Lovelace|Analytical/);
	});
});
