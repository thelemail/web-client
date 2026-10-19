import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { commands } from 'vitest/browser';
import { renderBody } from './render';
import EmailBody from './EmailBody.svelte';

declare module 'vitest/browser' {
	interface BrowserCommands {
		linkProbeOrigin: () => Promise<string>;
		clickMailLink: (text: string, modified?: boolean) => Promise<{ url: string; title: string } | null>;
	}
}

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

const clean = JSON.stringify({ ran: true, opener: false, referrer: '' });

async function show(html: string) {
	const { srcDoc } = await renderBody({ html });
	const { container } = render(EmailBody, { srcDoc });
	const frame = container.querySelector('iframe.email-frame') as HTMLIFrameElement;
	await vi.waitFor(() => expect(frame.contentDocument?.body?.querySelector('a')).toBeTruthy());
	return frame;
}

describe('EmailBody links', () => {
	let probe: string;

	beforeEach(async () => {
		probe = await commands.linkProbeOrigin();
		goto.mockReset();
	});

	afterEach(() => cleanup());

	it('opens an external page as a working tab without opener or referrer', async () => {
		await show(`<p><a href="${probe}/page">external</a></p>`);
		const tab = await commands.clickMailLink('external');
		expect(tab?.url).toBe(`${probe}/page`);
		expect(tab?.title).toBe(clean);
		expect(goto).not.toHaveBeenCalled();
	});

	it('opens an external page that sets COOP', async () => {
		await show(`<p><a href="${probe}/coop">isolated</a></p>`);
		const tab = await commands.clickMailLink('isolated');
		expect(tab?.url).toBe(`${probe}/coop`);
		expect(tab?.title).toBe(clean);
	});

	it('navigates in-app for a link back to the app', async () => {
		await show(`<p><a href="${location.origin}/invite/tok-123?x=1#top">join</a></p>`);
		const tab = await commands.clickMailLink('join');
		expect(tab).toBeNull();
		expect(goto).toHaveBeenCalledWith('/invite/tok-123?x=1#top');
	});

	it('leaves a modified click on an app link to the browser', async () => {
		await show(`<p><a href="${location.origin}/invite/tok-123">join</a></p>`);
		const tab = await commands.clickMailLink('join', true);
		expect(tab?.url).toBe(`${location.origin}/invite/tok-123`);
		expect(goto).not.toHaveBeenCalled();
	});

	it('keeps the body itself sandboxed without scripts', async () => {
		const frame = await show(`<p><a href="${probe}/page">external</a></p>`);
		const flags = [...frame.sandbox];
		expect(flags).not.toContain('allow-scripts');
		expect(flags).not.toContain('allow-top-navigation');
		expect(flags).not.toContain('allow-forms');
		const anchor = frame.contentDocument!.querySelector('a')!;
		expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
		expect(anchor.getAttribute('target')).toBe('_blank');
	});
});
