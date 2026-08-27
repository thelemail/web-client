import type { Editor } from '@tiptap/core';

export function applySignatureSeed(editor: Editor, _addressId: string, bodyHtml: string): void {
	if (!bodyHtml || !bodyHtml.trim()) return;
	const existing = (editor.getHTML() || '').trim();
	const isEmpty = existing === '' || existing === '<p></p>';
	if (!isEmpty) return;
	const content = `<p></p><p></p>${bodyHtml}`;
	editor.commands.setContent(content, { emitUpdate: true });
	editor.commands.setTextSelection(1);
}

export function swapSignatureForAddress(
	_editor: Editor,
	_addressId: string,
	_bodyHtml: string
): void {
	return;
}

export function unwrapSignatureSentinel(html: string): string {
	return html;
}
