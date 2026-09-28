import { describe, it, expect } from 'vitest';
import { canPreview, extensionOf, previewKind, previewMimeType } from './previewKind';

describe('previewKind', () => {
	it('classifies by content type', () => {
		expect(previewKind('image/png', 'x')).toBe('image');
		expect(previewKind('image/svg+xml', 'logo')).toBe('image');
		expect(previewKind('application/pdf', 'scan')).toBe('pdf');
		expect(previewKind('text/plain; charset=utf-8', 'notes')).toBe('text');
		expect(previewKind('text/csv', 'q3')).toBe('text');
		expect(previewKind('application/json', 'data')).toBe('text');
		expect(previewKind('application/vnd.api+json', 'data')).toBe('text');
	});

	it('refuses html and undecodable images', () => {
		expect(previewKind('text/html', 'page.html')).toBeNull();
		expect(previewKind('image/heic', 'IMG_0001.heic')).toBeNull();
		expect(previewKind('image/tiff', 'scan.tif')).toBeNull();
	});

	it('falls back to the extension for octet-stream', () => {
		expect(previewKind('application/octet-stream', 'Invoice.PDF')).toBe('pdf');
		expect(previewKind('application/octet-stream', 'photo.jpeg')).toBe('image');
		expect(previewKind('application/octet-stream', 'server.log')).toBe('text');
		expect(previewKind('', 'readme.md')).toBe('text');
		expect(previewKind('application/octet-stream', 'archive.zip')).toBeNull();
		expect(previewKind('application/octet-stream', 'noext')).toBeNull();
	});

	it('trusts a pdf or image extension behind a generic download type', () => {
		expect(previewKind('application/force-download', 'contract.pdf')).toBe('pdf');
		expect(previewKind('application/x-download', 'photo.png')).toBe('image');
	});

	it('never treats a binary type as text because of its name', () => {
		expect(previewKind('application/zip', 'bundle.txt')).toBeNull();
		expect(previewKind('application/msword', 'q3-plan.doc')).toBeNull();
	});
});

describe('canPreview', () => {
	it('applies the per-kind size cap', () => {
		expect(canPreview('text/plain', 'a.txt', 2 * 1024 * 1024)).toBe(true);
		expect(canPreview('text/plain', 'a.txt', 2 * 1024 * 1024 + 1)).toBe(false);
		expect(canPreview('application/pdf', 'a.pdf', 20 * 1024 * 1024)).toBe(true);
		expect(canPreview('application/zip', 'a.zip', 10)).toBe(false);
	});
});

describe('previewMimeType', () => {
	it('pins the type the viewer renders with', () => {
		expect(previewMimeType('image', 'application/octet-stream', 'logo.svg')).toBe('image/svg+xml');
		expect(previewMimeType('image', 'application/octet-stream', 'a.JPG')).toBe('image/jpeg');
		expect(previewMimeType('image', 'image/webp', 'a')).toBe('image/webp');
		expect(previewMimeType('text', 'text/html', 'a.txt')).toBe('text/plain');
		expect(previewMimeType('pdf', 'application/x-download', 'a.pdf')).toBe('application/pdf');
	});
});

describe('extensionOf', () => {
	it('ignores dotfiles and missing extensions', () => {
		expect(extensionOf('.env')).toBe('');
		expect(extensionOf('README')).toBe('');
		expect(extensionOf('a.tar.GZ')).toBe('gz');
	});
});
