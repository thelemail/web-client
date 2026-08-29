import type { Editor } from '@tiptap/core';
import { SIGNATURE_ATTR } from './editor/signatureBlock';

function wrap(bodyHtml: string): string {
	return `<div ${SIGNATURE_ATTR}="1">${bodyHtml}</div>`;
}

export function applySignatureSeed(editor: Editor, _addressId: string, bodyHtml: string): void {
	if (!bodyHtml || !bodyHtml.trim()) return;
	const existing = (editor.getHTML() || '').trim();
	const isEmpty = existing === '' || existing === '<p></p>';
	if (!isEmpty) return;
	editor.commands.setContent(`<p></p><p></p>${wrap(bodyHtml)}`, { emitUpdate: true });
	editor.commands.setTextSelection(1);
}

export function swapSignatureForAddress(
	editor: Editor,
	_addressId: string,
	bodyHtml: string
): void {
	const html = editor.getHTML() || '';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const nodes = doc.querySelectorAll(`[${SIGNATURE_ATTR}]`);
	const region = nodes.length ? nodes[nodes.length - 1] : null;

	if (!region) {
		if (!bodyHtml || !bodyHtml.trim()) return;
		const caret = editor.state.selection.from;
		editor.commands.setContent(`${html}${wrap(bodyHtml)}`, { emitUpdate: true });
		editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
		return;
	}

	if (!bodyHtml || !bodyHtml.trim()) {
		region.remove();
	} else {
		region.innerHTML = bodyHtml;
	}
	const caret = editor.state.selection.from;
	editor.commands.setContent(doc.body.innerHTML, { emitUpdate: true });
	editor.commands.setTextSelection(Math.min(caret, editor.state.doc.content.size));
}

export function unwrapSignatureSentinel(html: string): string {
	if (!html.includes(SIGNATURE_ATTR)) return html;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const region of doc.querySelectorAll(`[${SIGNATURE_ATTR}]`)) {
		region.replaceWith(...region.childNodes);
	}
	return doc.body.innerHTML;
}
