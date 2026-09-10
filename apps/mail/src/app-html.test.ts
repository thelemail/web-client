import { describe, expect, it } from 'vitest';
import html from './app.html?raw';

describe('app.html', () => {
	it('loads no third-party script', () => {
		expect(html).not.toMatch(/<script[^>]*\bsrc=/i);
	});

	it('emits the content security policy before any inline script', () => {
		expect(html.indexOf('%sveltekit.head%')).toBeLessThan(html.indexOf('<script'));
	});
});
