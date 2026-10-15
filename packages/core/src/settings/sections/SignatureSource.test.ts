import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: {
		objectUrl: (key: string) => `blob:${key}`,
		ensureObjectUrl: vi.fn()
	}
}));

const { default: SignatureSource } = await import('./SignatureSource.svelte');

const IMG = 'data-thelemail-sig-image';

afterEach(() => cleanup());

function preview(html: string) {
	render(SignatureSource, {
		props: { value: html, placeholder: '', previewHtml: html, onChange: vi.fn() }
	});
	return document.querySelector('.sig-preview') as HTMLElement;
}

describe('SignatureSource', () => {
	it('drops style blocks and remote css from the preview', async () => {
		const el = preview(
			'<style>body{display:none}</style>' +
				'<p style="color:red;background:url(https://evil.example/x.png)">Ada</p>'
		);
		await tick();
		expect(el.querySelector('style')).toBeNull();
		expect(el.innerHTML).not.toContain('evil.example');
		expect(el.textContent).toContain('Ada');
		expect(el.querySelector('p')?.getAttribute('style')).toContain('color');
	});

	it('still resolves hosted signature images', async () => {
		const el = preview(`<p>Ada</p><img ${IMG}="k1" src="">`);
		await tick();
		expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:k1');
	});
});
