<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import type { Editor } from '@tiptap/core';
	import type { Snippet } from 'svelte';
	import LinkDialog from './LinkDialog.svelte';
	import { applyLink, currentLink } from './link';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		faLink,
		faListOl,
		faListUl,
		faPenLine,
		faQuoteLeft
	} from '@fortawesome/pro-regular-svg-icons';

	interface SignatureControl {
		present: boolean;
		on: boolean;
		disabled?: boolean;
		onToggle: (value: boolean) => void;
	}

	interface Props {
		editor: Editor | null;
		signature?: SignatureControl;
		extra?: Snippet;
	}

	let { editor, signature, extra }: Props = $props();

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

	let linkInitial = $state<string | null>(null);

	function link() {
		if (!editor) return;
		linkInitial = currentLink(editor);
	}

	function closeLink() {
		linkInitial = null;
		focus();
	}

	function submitLink(url: string) {
		linkInitial = null;
		if (editor) applyLink(editor, url);
	}
</script>

<div class="cbar" role="toolbar" aria-label={m.mail_toolbar_aria()}>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_bold()} aria-label={m.mail_toolbar_bold()} aria-pressed={active.bold} onclick={bold}>
		<b>B</b>
	</Button>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_italic()} aria-label={m.mail_toolbar_italic()} aria-pressed={active.italic} onclick={italic}>
		<i>I</i>
	</Button>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_underline()} aria-label={m.mail_toolbar_underline()} aria-pressed={active.underline} onclick={underline}>
		<u>U</u>
	</Button>
	<span class="cbar-sep"></span>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_bulleted()} aria-label={m.mail_toolbar_bulleted()} aria-pressed={active.ul} onclick={ul}>
		<Icon icon={faListUl} size={16} />
	</Button>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_numbered()} aria-label={m.mail_toolbar_numbered()} aria-pressed={active.ol} onclick={ol}>
		<Icon icon={faListOl} size={16} />
	</Button>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_link()} aria-label={m.mail_toolbar_link()} aria-pressed={active.link} onclick={link}>
		<Icon icon={faLink} size={16} />
	</Button>
	<Button variant="ghost" size="icon-sm" title={m.mail_toolbar_quote()} aria-label={m.mail_toolbar_quote()} aria-pressed={active.quote} onclick={quote}>
		<Icon icon={faQuoteLeft} size={16} />
	</Button>
	{#if signature?.present}
		<span class="cbar-sep"></span>
		<Button
			variant="ghost"
			size="icon-sm"
			title={signature.on ? m.mail_toolbar_remove_signature() : m.mail_toolbar_add_signature()}
			aria-label={signature.on ? m.mail_toolbar_remove_signature() : m.mail_toolbar_add_signature()}
			aria-pressed={signature.on}
			disabled={signature.disabled}
			onclick={() => signature.onToggle(!signature.on)}
		>
			<Icon icon={faPenLine} size={16} />
		</Button>
	{/if}
	{#if extra}
		<span class="cbar-sep"></span>
		{@render extra()}
	{/if}
</div>

{#if linkInitial !== null}
	<LinkDialog initial={linkInitial} onApply={submitLink} onClose={closeLink} />
{/if}

<style>
	.cbar {
		display: flex;
		align-items: center;
		gap: 1px;
		flex: 0 0 auto;
		padding: 6px 13px;
		border-top: 1px solid var(--border);
		background: var(--bg-raised);
	}
	.cbar-sep {
		width: 1px;
		height: 18px;
		background: var(--border-strong);
		margin: 0 6px;
	}
</style>
