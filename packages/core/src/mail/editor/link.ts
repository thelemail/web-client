import type { Editor } from '@tiptap/core';

export function currentLink(editor: Editor): string {
	return (editor.getAttributes('link').href as string | undefined) ?? '';
}

export function applyLink(editor: Editor, url: string): void {
	if (url === '') {
		editor.chain().focus().extendMarkRange('link').unsetLink().run();
		return;
	}
	const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
	editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}
