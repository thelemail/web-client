<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import LinkIcon from '@lucide/svelte/icons/link';
	import Quote from '@lucide/svelte/icons/quote';

	interface Props {
		editor: Editor | null;
	}

	let { editor }: Props = $props();

	let tick = $state(0);

	$effect(() => {
		if (!editor) return;
		const bump = () => (tick++);
		editor.on('selectionUpdate', bump);
		editor.on('transaction', bump);
		return () => {
			editor?.off('selectionUpdate', bump);
			editor?.off('transaction', bump);
		};
	});

	const active = $derived.by(() => {
		void tick;
		if (!editor) {
			return { bold: false, italic: false, underline: false, ul: false, ol: false, link: false, quote: false };
		}
		return {
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			underline: editor.isActive('underline'),
			ul: editor.isActive('bulletList'),
			ol: editor.isActive('orderedList'),
			link: editor.isActive('link'),
			quote: editor.isActive('blockquote')
		};
	});

	function focus() {
		editor?.commands.focus();
	}
	const bold = () => editor?.chain().focus().toggleBold().run();
	const italic = () => editor?.chain().focus().toggleItalic().run();
	const underline = () => editor?.chain().focus().toggleUnderline().run();
	const ul = () => editor?.chain().focus().toggleBulletList().run();
	const ol = () => editor?.chain().focus().toggleOrderedList().run();
	const quote = () => editor?.chain().focus().toggleBlockquote().run();

	function link() {
		if (!editor) return;
		const previous = editor.getAttributes('link').href ?? '';
		const url = window.prompt('Link URL', previous);
		focus();
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		const normalized = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
		editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
	}
</script>

<div class="cbar" role="toolbar" aria-label="Formatting">
	<button type="button" title="Bold" class:on={active.bold} aria-pressed={active.bold} onclick={bold}>
		<b>B</b>
	</button>
	<button type="button" title="Italic" class:on={active.italic} aria-pressed={active.italic} onclick={italic}>
		<i>I</i>
	</button>
	<button type="button" title="Underline" class:on={active.underline} aria-pressed={active.underline} onclick={underline}>
		<u>U</u>
	</button>
	<span class="cbar-sep"></span>
	<button type="button" title="Bulleted list" class:on={active.ul} aria-pressed={active.ul} onclick={ul}>
		<List size={16} />
	</button>
	<button type="button" title="Numbered list" class:on={active.ol} aria-pressed={active.ol} onclick={ol}>
		<ListOrdered size={16} />
	</button>
	<button type="button" title="Insert link" class:on={active.link} aria-pressed={active.link} onclick={link}>
		<LinkIcon size={16} />
	</button>
	<button type="button" title="Quote" class:on={active.quote} aria-pressed={active.quote} onclick={quote}>
		<Quote size={16} />
	</button>
</div>

<style>
	.cbar {
		display: flex;
		align-items: center;
		gap: 1px;
		flex: 0 0 auto;
		padding: 6px 13px;
		border-top: 1px solid var(--border, #e6dfcd);
		background: var(--paper-50, #f6f1e3);
	}
	.cbar button {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--ink-600, #4a4d3f);
		cursor: pointer;
		font-size: 14px;
		font-family: var(--font-sans);
	}
	.cbar button:hover {
		background: var(--paper-150, #ece4d0);
		color: var(--fg, #1f221b);
	}
	.cbar button.on {
		background: var(--paper-200, #e0d6bf);
		color: var(--fg-strong, #1f221b);
	}
	.cbar button :global(svg) {
		width: 16px;
		height: 16px;
	}
	.cbar-sep {
		width: 1px;
		height: 18px;
		background: var(--border-strong, #cfc4ad);
		margin: 0 6px;
	}
</style>
