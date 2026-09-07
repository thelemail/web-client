import type { Editor } from '@tiptap/core';
import { SIGNATURE_ATTR } from './editor/signatureBlock';

export interface SignatureRange {
	from: number;
	to: number;
}

function wrap(bodyHtml: string): string {
	return `<div ${SIGNATURE_ATTR}="1">${bodyHtml}</div>`;
}

export function findSignatureRange(editor: Editor): SignatureRange | null {
	let found: SignatureRange | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'signatureBlock') {
			found = { from: pos, to: pos + node.nodeSize };
		}
		return true;
	});
	return found;
}

export function hasSignature(editor: Editor): boolean {
	return findSignatureRange(editor) !== null;
}

export function applySignatureSeed(editor: Editor, bodyHtml: string): void {
	if (!bodyHtml || !bodyHtml.trim()) return;
	const existing = (editor.getHTML() || '').trim();
	const isEmpty = existing === '' || existing === '<p></p>';
	if (!isEmpty) return;
	editor.commands.setContent(`<p></p><p></p>${wrap(bodyHtml)}`, { emitUpdate: true });
	editor.commands.setTextSelection(1);
}

export function insertSignature(editor: Editor, bodyHtml: string): void {
	if (!bodyHtml || !bodyHtml.trim()) return;
	if (hasSignature(editor)) {
		replaceSignature(editor, bodyHtml);
		return;
	}
	const caret = editor.state.selection.from;
	editor
		.chain()
		.insertContentAt(editor.state.doc.content.size, wrap(bodyHtml))
		.run();
	editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
}

export function removeSignature(editor: Editor): void {
	const range = findSignatureRange(editor);
	if (!range) return;
	const caret = editor.state.selection.from;
	editor.chain().deleteRange(range).run();
	editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
}

export function replaceSignature(editor: Editor, bodyHtml: string): void {
	const range = findSignatureRange(editor);
	if (!range) {
		insertSignature(editor, bodyHtml);
		return;
	}
	if (!bodyHtml || !bodyHtml.trim()) {
		removeSignature(editor);
		return;
	}
	const caret = editor.state.selection.from;
	editor.chain().insertContentAt(range, wrap(bodyHtml)).run();
	editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
}

export function swapSignatureForAddress(editor: Editor, bodyHtml: string): void {
	if (!bodyHtml || !bodyHtml.trim()) {
		removeSignature(editor);
		return;
	}
	replaceSignature(editor, bodyHtml);
}

export function unwrapSignatureSentinel(html: string): string {
	if (!html.includes(SIGNATURE_ATTR)) return html;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const region of doc.querySelectorAll(`[${SIGNATURE_ATTR}]`)) {
		region.replaceWith(...region.childNodes);
	}
	return doc.body.innerHTML;
}

export function hasRenderableHtml(html: string): boolean {
	if (!html || !html.trim()) return false;
	if (typeof DOMParser === 'undefined') return html.trim() !== '<p></p>';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	if ((doc.body.textContent ?? '').trim()) return true;
	return doc.body.querySelector('img, table, hr, video, audio') !== null;
}
