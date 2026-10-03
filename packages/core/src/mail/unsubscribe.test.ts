import { describe, it, expect } from 'vitest';
import { parseMailto, unsubscribeMethod } from './unsubscribe';
import { unsubscribeFromPreview, type MessagePreview } from './preview';

function preview(unsubscribe: unknown): MessagePreview {
	return {
		v: 1,
		subject: 's',
		sender: { display: 'News', address: 'news@list.example' },
		recipients: [],
		snippet: '',
		display_date: '2026-10-03T00:00:00Z',
		flags: { unsubscribe }
	};
}

describe('parseMailto', () => {
	it('reads address, subject and body', () => {
		expect(parseMailto('mailto:leave@list.example?subject=Remove%20me&body=id%3D42')).toEqual({
			to: 'leave@list.example',
			subject: 'Remove me',
			body: 'id=42'
		});
	});

	it('keeps plus signs literal', () => {
		expect(parseMailto('mailto:leave+abc@list.example')?.to).toBe('leave+abc@list.example');
	});

	it('falls back to an unsubscribe subject and body', () => {
		expect(parseMailto('mailto:leave@list.example')).toEqual({
			to: 'leave@list.example',
			subject: 'unsubscribe',
			body: 'unsubscribe'
		});
	});

	it('takes the address from a to field', () => {
		expect(parseMailto('mailto:?to=leave%40list.example')?.to).toBe('leave@list.example');
	});

	it('strips header injection from the subject', () => {
		expect(parseMailto('mailto:a@b.example?subject=x%0D%0ABcc%3A%20c%40d.example')?.subject).toBe(
			'x Bcc: c@d.example'
		);
	});

	it('rejects malformed input', () => {
		expect(parseMailto('https://list.example')).toBeNull();
		expect(parseMailto('mailto:not-an-address')).toBeNull();
		expect(parseMailto('mailto:a@b.example?subject=%E0%A4%A')).toBeNull();
	});
});

describe('unsubscribeFromPreview', () => {
	it('accepts sealed one-click links', () => {
		expect(
			unsubscribeFromPreview(
				preview({ one_click: { url: 'https://list.example/u?id=1', tag: 'aB-_9' }, mailto: 'mailto:x@list.example' })
			)
		).toEqual({
			oneClick: { url: 'https://list.example/u?id=1', tag: 'aB-_9' },
			mailto: 'mailto:x@list.example'
		});
	});

	it('drops unsafe values', () => {
		expect(
			unsubscribeFromPreview(
				preview({
					one_click: { url: 'http://list.example/u', tag: 'abc' },
					https: 'https://user:pw@list.example/u',
					mailto: 'javascript:alert(1)'
				})
			)
		).toBeUndefined();
		expect(unsubscribeFromPreview(preview({ one_click: { url: 'https://list.example/u', tag: 'a b' } }))).toBeUndefined();
		expect(unsubscribeFromPreview(preview({ https: 'https://list.example:8443/u' }))).toBeUndefined();
		expect(unsubscribeFromPreview(preview('nope'))).toBeUndefined();
	});
});

describe('unsubscribeMethod', () => {
	it('prefers one-click, then mail, then the page', () => {
		const oneClick = { url: 'https://list.example/u', tag: 't' };
		expect(unsubscribeMethod({ oneClick, mailto: 'mailto:a@b.example', page: 'https://p.example' })?.kind).toBe(
			'one-click'
		);
		expect(unsubscribeMethod({ mailto: 'mailto:a@b.example', page: 'https://p.example' })?.kind).toBe('mailto');
		expect(unsubscribeMethod({ mailto: 'mailto:broken', page: 'https://p.example' })).toEqual({
			kind: 'page',
			url: 'https://p.example'
		});
		expect(unsubscribeMethod(undefined)).toBeNull();
	});
});
