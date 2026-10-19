import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { commands } from 'vitest/browser';
import { renderBody } from './render';
import EmailBody from './EmailBody.svelte';

declare module 'vitest/browser' {
	interface BrowserCommands {
		linkProbeOrigin: () => Promise<string>;
		clickMailLink: (selector: string) => Promise<{ url: string; title: string } | null>;
	}
}

const clean = JSON.stringify({ ran: true, opener: false, referrer: '' });

async function show(html: string) {
	const { srcDoc } = await renderBody({ html });
	const { container } = render(EmailBody, { srcDoc });
	const frame = container.querySelector('iframe.email-frame') as HTMLIFrameElement;
	await vi.waitFor(() => expect(frame.contentDocument?.body?.querySelector('a, area')).toBeTruthy());
	return frame;
}

describe('EmailBody links', () => {
	let external: string;

	beforeEach(async () => {
		external = await commands.linkProbeOrigin();
	});

	afterEach(() => cleanup());

	it('opens a link back to the app, which sets COOP', async () => {
		const app = `${location.origin}/__link-probe/coop?invite=tok-123`;
		await show(`<p><a href="${app}">join</a></p>`);
		const tab = await commands.clickMailLink('a:text-is("join")');
		expect(tab?.url).toBe(app);
		expect(tab?.title).toBe(clean);
	});

	it('opens an external page as a working tab without opener or referrer', async () => {
		await show(`<p><a href="${external}/page">external</a></p>`);
		const tab = await commands.clickMailLink('a:text-is("external")');
		expect(tab?.url).toBe(`${external}/page`);
		expect(tab?.title).toBe(clean);
	});

	it('opens an external page that sets COOP', async () => {
		await show(`<p><a href="${external}/coop">isolated</a></p>`);
		const tab = await commands.clickMailLink('a:text-is("isolated")');
		expect(tab?.url).toBe(`${external}/coop`);
		expect(tab?.title).toBe(clean);
	});

	it('opens an image-map area without opener or referrer', async () => {
		const pixel =
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
		await show(
			`<img src="${pixel}" width="200" height="100" usemap="#m">` +
				`<map name="m"><area shape="default" alt="banner" rel="opener" href="${external}/page"></map>`
		);
		const tab = await commands.clickMailLink('img[usemap]');
		expect(tab?.url).toBe(`${external}/page`);
		expect(tab?.title).toBe(clean);
	});

	it('keeps the body itself sandboxed without scripts', async () => {
		const frame = await show(`<p><a href="${external}/page">external</a></p>`);
		const flags = [...frame.sandbox];
		expect(flags).not.toContain('allow-scripts');
		expect(flags).not.toContain('allow-top-navigation');
		expect(flags).not.toContain('allow-top-navigation-by-user-activation');
		expect(flags).not.toContain('allow-forms');
		const anchor = frame.contentDocument!.querySelector('a')!;
		expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
		expect(anchor.getAttribute('target')).toBe('_blank');
	});
});
