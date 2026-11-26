<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { onDestroy, untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { Button } from '$core/components/ui/button';
	import { loadEditorKit, loadedEditorKit, type EditorKit } from './loadKit';

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
		placeholder = m.mail_editor_placeholder(),
		disabled = false,
		autofocus = false,
		editor = $bindable<Editor | null>(null),
		ariaLabel = m.mail_editor_aria(),
		class: cls = 'cbody'
	}: Props = $props();

	let mountEl: HTMLDivElement | undefined = $state();
	let kit = $state.raw<EditorKit | null>(loadedEditorKit());
	let failed = $state(false);
	let suppressWrite = false;

	function fetchKit() {
		failed = false;
		loadEditorKit().then(
			(k) => (kit = k),
			() => (failed = true)
		);
	}

	if (!loadedEditorKit()) fetchKit();

	$effect(() => {
		if (!mountEl || !kit) return;
		const setup = untrack(() => ({
			html: html || '',
			editable: !disabled,
			placeholder,
			className: cls,
			ariaLabel,
			autofocus
		}));
		const e = kit.createEditor({
			...setup,
			element: mountEl,
			onUpdate(ed) {
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
>
	{#if failed}
		<div class="rich-editor-failed" role="alert">
			<span>{m.mail_editor_load_failed()}</span>
			<Button variant="neutral" size="sm" onclick={fetchKit}>{m.common_retry()}</Button>
		</div>
	{/if}
</div>

<style>
	.rich-editor {
		flex: 1 1 auto;
		min-height: 170px;
		display: flex;
		flex-direction: column;
	}
	.rich-editor-failed {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 17px;
		font-size: 14px;
		color: var(--fg-muted);
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
		color: var(--fg-faint);
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
		color: var(--link);
		text-decoration: underline;
	}
	.rich-editor :global(.cbody .eb-quote) {
		margin: 0 0 12px;
		padding-left: 12px;
		border-left: 3px solid var(--border-strong);
		color: var(--fg);
	}
</style>
