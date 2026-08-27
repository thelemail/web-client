<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Underline from '@tiptap/extension-underline';
	import Link from '@tiptap/extension-link';
	import Placeholder from '@tiptap/extension-placeholder';

	interface Props {
		html?: string;
		text?: string;
		placeholder?: string;
		disabled?: boolean;
		autofocus?: boolean;
		editor?: Editor | null;
		ariaLabel?: string;
		class?: string;
	}

	let {
		html = $bindable(''),
		text = $bindable(''),
		placeholder = 'Write your message…',
		disabled = false,
		autofocus = false,
		editor = $bindable<Editor | null>(null),
		ariaLabel = 'Message body',
		class: cls = 'cbody'
	}: Props = $props();

	let mountEl: HTMLDivElement | undefined = $state();
	let suppressWrite = false;

	$effect(() => {
		if (!mountEl) return;
		const initialHtml = untrack(() => html);
		const initialEditable = !untrack(() => disabled);
		const initialPlaceholder = untrack(() => placeholder);
		const initialClass = untrack(() => cls);
		const initialAria = untrack(() => ariaLabel);
		const initialAutofocus = untrack(() => autofocus);

		const e = new Editor({
			element: mountEl,
			autofocus: initialAutofocus ? 'start' : false,
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
				Placeholder.configure({ placeholder: initialPlaceholder })
			],
			content: initialHtml || '',
			editable: initialEditable,
			editorProps: {
				attributes: {
					class: initialClass,
					role: 'textbox',
					'aria-label': initialAria,
					'aria-multiline': 'true',
					tabindex: '0',
					spellcheck: 'true'
				}
			},
			onUpdate({ editor: ed }) {
				suppressWrite = true;
				html = ed.getHTML();
				text = ed.getText();
				suppressWrite = false;
			}
		});
		editor = e;
		return () => {
			editor = null;
			e.destroy();
		};
	});

	$effect(() => {
		const next = html;
		if (!editor) return;
		if (suppressWrite) return;
		if (editor.getHTML() === next) return;
		editor.commands.setContent(next || '', { emitUpdate: false });
	});

	$effect(() => {
		const isDisabled = disabled;
		if (!editor) return;
		editor.setEditable(!isDisabled);
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	const isEmpty = $derived(!text?.trim());
</script>

<div
	bind:this={mountEl}
	class="rich-editor"
	class:empty={isEmpty}
	data-placeholder={placeholder}
></div>

<style>
	.rich-editor {
		flex: 1 1 auto;
		min-height: 170px;
		display: flex;
		flex-direction: column;
	}
	.rich-editor :global(.cbody) {
		flex: 1 1 auto;
		min-height: 170px;
		padding: 16px 17px;
		font-size: 14.5px;
		line-height: 1.65;
		outline: none;
	}
	.rich-editor.empty :global(.cbody.ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		color: var(--fg-faint, #9a8f7d);
		pointer-events: none;
		float: left;
		height: 0;
	}
	.rich-editor :global(.cbody p) {
		margin: 0 0 12px;
	}
	.rich-editor :global(.cbody p:last-child) {
		margin-bottom: 0;
	}
	.rich-editor :global(.cbody ul),
	.rich-editor :global(.cbody ol) {
		margin: 0 0 12px;
		padding-left: 22px;
	}
	.rich-editor :global(.cbody a) {
		color: var(--link, #2b5aa3);
		text-decoration: underline;
	}
	.rich-editor :global(.cbody .eb-quote) {
		margin: 0 0 12px;
		padding-left: 12px;
		border-left: 3px solid var(--paper-200, #d6cbb6);
		color: var(--ink-700, #43473a);
	}
</style>
