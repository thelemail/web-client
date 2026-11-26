import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { SignatureBlock } from './signatureBlock';
import { SignatureImage } from './signatureImage';

export interface EditorSetup {
	element: HTMLElement;
	html: string;
	editable: boolean;
	placeholder: string;
	className: string;
	ariaLabel: string;
	autofocus: boolean;
	onUpdate: (editor: Editor) => void;
}

export function createEditor(setup: EditorSetup): Editor {
	return new Editor({
		element: setup.element,
		autofocus: setup.autofocus ? 'start' : false,
		extensions: [
			StarterKit.configure({
				heading: false,
				codeBlock: false,
				horizontalRule: false,
				strike: false,
				blockquote: { HTMLAttributes: { class: 'eb-quote' } }
			}),
			Underline,
			Link.configure({
				openOnClick: false,
				autolink: true,
				HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
			}),
			Placeholder.configure({ placeholder: setup.placeholder }),
			SignatureBlock,
			SignatureImage
		],
		content: setup.html,
		editable: setup.editable,
		editorProps: {
			attributes: {
				class: setup.className,
				role: 'textbox',
				'aria-label': setup.ariaLabel,
				'aria-multiline': 'true',
				tabindex: '0',
				spellcheck: 'true'
			}
		},
		onUpdate({ editor }) {
			setup.onUpdate(editor);
		}
	});
}
