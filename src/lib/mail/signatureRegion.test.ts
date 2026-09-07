import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SignatureBlock } from './editor/signatureBlock';
import {
	applySignatureSeed,
	insertSignature,
	removeSignature,
	replaceSignature,
	swapSignatureForAddress,
	findSignatureRange,
	hasSignature,
	unwrapSignatureSentinel,
	hasRenderableHtml
} from './signatureRegion';

const SIG = 'data-thelemail-signature';
const ADA = '<p>Ada Lovelace</p>';
const GRACE = '<p>Grace Hopper</p>';

let editor: Editor;

function makeEditor(content = '') {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return new Editor({
		element: el,
		extensions: [
			StarterKit.configure({
				heading: false,
				codeBlock: false,
				horizontalRule: false,
				strike: false
			}),
			SignatureBlock
		],
		content
	});
}

function regionCount(ed: Editor): number {
	let n = 0;
	ed.state.doc.descendants((node) => {
		if (node.type.name === 'signatureBlock') n++;
		return true;
	});
	return n;
}

beforeEach(() => {
	editor = makeEditor();
});

afterEach(() => {
	editor.destroy();
});

describe('applySignatureSeed', () => {
	it('seeds an empty document and leaves the caret above the signature', () => {
		applySignatureSeed(editor, ADA);
		expect(hasSignature(editor)).toBe(true);
		expect(editor.getHTML()).toContain('Ada Lovelace');
		const range = findSignatureRange(editor)!;
		expect(editor.state.selection.from).toBeLessThan(range.from);
	});

	it('does nothing when the document already has content', () => {
		editor.commands.setContent('<p>already writing</p>');
		applySignatureSeed(editor, ADA);
		expect(hasSignature(editor)).toBe(false);
	});

	it('does nothing for an empty signature', () => {
		applySignatureSeed(editor, '   ');
		expect(hasSignature(editor)).toBe(false);
	});
});

describe('insert and remove', () => {
	it('appends to a non-empty document, which the seed path refuses to do', () => {
		editor.commands.setContent('<p>hello there</p>');
		insertSignature(editor, ADA);
		expect(hasSignature(editor)).toBe(true);
		expect(editor.getText()).toContain('hello there');
		expect(editor.getText()).toContain('Ada Lovelace');
	});

	it('round-trips off and on without duplicating the region', () => {
		editor.commands.setContent('<p>body</p>');
		insertSignature(editor, ADA);
		removeSignature(editor);
		expect(hasSignature(editor)).toBe(false);
		expect(editor.getText()).toContain('body');

		insertSignature(editor, ADA);
		insertSignature(editor, ADA);
		expect(regionCount(editor)).toBe(1);
	});

	it('removing when there is no signature is a no-op', () => {
		editor.commands.setContent('<p>body</p>');
		removeSignature(editor);
		expect(editor.getText()).toContain('body');
	});
});

describe('swapSignatureForAddress', () => {
	it('replaces the body in place and keeps exactly one region', () => {
		editor.commands.setContent('<p>body</p>');
		insertSignature(editor, ADA);
		swapSignatureForAddress(editor, GRACE);

		expect(regionCount(editor)).toBe(1);
		expect(editor.getText()).toContain('Grace Hopper');
		expect(editor.getText()).not.toContain('Ada Lovelace');
		expect(editor.getText()).toContain('body');
	});

	it('removes the region when the new identity has no signature', () => {
		insertSignature(editor, ADA);
		swapSignatureForAddress(editor, '');
		expect(hasSignature(editor)).toBe(false);
	});

	it('adds a region when there was none', () => {
		editor.commands.setContent('<p>body</p>');
		swapSignatureForAddress(editor, GRACE);
		expect(regionCount(editor)).toBe(1);
	});

	it('preserves the caret position across a swap', () => {
		editor.commands.setContent('<p>hello there friend</p>');
		insertSignature(editor, ADA);
		editor.commands.setTextSelection(5);
		replaceSignature(editor, GRACE);
		expect(editor.state.selection.from).toBe(5);
	});
});

describe('unwrapSignatureSentinel', () => {
	it('keeps the children and drops the wrapper', () => {
		const out = unwrapSignatureSentinel(`<p>hi</p><div ${SIG}="1"><p>Ada</p></div>`);
		expect(out).toBe('<p>hi</p><p>Ada</p>');
	});

	it('leaves html without a sentinel untouched', () => {
		expect(unwrapSignatureSentinel('<p>hi</p>')).toBe('<p>hi</p>');
	});
});

describe('hasRenderableHtml', () => {
	it('is false for empty and whitespace-only bodies', () => {
		expect(hasRenderableHtml('')).toBe(false);
		expect(hasRenderableHtml('<p></p>')).toBe(false);
	});

	it('is true when there is text', () => {
		expect(hasRenderableHtml('<p>hi</p>')).toBe(true);
	});

	it('is true for an image-only signature, which used to be dropped from replies', () => {
		expect(hasRenderableHtml('<p><img data-thelemail-sig-image="k1" src=""></p>')).toBe(true);
	});
});
