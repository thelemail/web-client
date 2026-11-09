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

describe('handoff callback capture', () => {
	it('copies and clears the callback fragment before any module runs', () => {
		const start = html.indexOf("if (location.pathname === '/auth/callback')");
		expect(start).toBeGreaterThan(html.indexOf('%sveltekit.head%'));
		const script = html.slice(start, html.indexOf('</script>', start));
		expect(script).toContain('window.__thelemailCallback = location.hash');
		expect(script).toContain("history.replaceState(null, '', '/auth/callback')");
	});
});
