<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { platform } from '$platform';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Code from '@lucide/svelte/icons/code';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Underline from '@tiptap/extension-underline';
	import Link from '@tiptap/extension-link';
	import ImageBase from '@tiptap/extension-image';

	const SignatureImage = ImageBase.extend({
		addAttributes() {
			return {
				...(this.parent?.() ?? {}),
				'data-thelemail-sig-image': {
					default: null,
					parseHTML: (el: HTMLElement) => el.getAttribute('data-thelemail-sig-image'),
					renderHTML: (attrs: Record<string, unknown>) => {
						const v = attrs['data-thelemail-sig-image'];
						if (!v) return {};
						return { 'data-thelemail-sig-image': v as string };
					}
				}
			};
		}
	});
	import Placeholder from '@tiptap/extension-placeholder';
	import {
		requestSignatureImageUploadUrl,
		commitSignatureImage,
		getSignatureImageDownloadUrl
	} from '$lib/api/signatures';
	import { signatures } from '$lib/stores/signatures.svelte';

	interface Props {
		addressId: string;
		bodyHtml: string;
		appendOnReply: boolean;
		onChange: (next: { bodyHtml: string; appendOnReply: boolean }) => void;
	}

	let { addressId, bodyHtml, appendOnReply, onChange }: Props = $props();

	const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	const MAX_BYTES = 2 * 1024 * 1024;

	let mountEl: HTMLDivElement | undefined = $state();
	let editor: Editor | null = $state(null);
	let suppress = false;
	let imageBusy = $state(false);
	let imageError = $state<string | null>(null);
	let fileInputRef: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!mountEl) return;
		const initialHtml = untrack(() => bodyHtml);
		const e = new Editor({
			element: mountEl,
			extensions: [
				StarterKit.configure({
					heading: false,
					codeBlock: false,
					horizontalRule: false,
					strike: false,
					blockquote: false
				}),
				Underline,
				Link.configure({
					openOnClick: false,
					autolink: true,
					HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
				}),
				SignatureImage.configure({
					HTMLAttributes: { class: 'sig-img' },
					allowBase64: false
				}),
				Placeholder.configure({ placeholder: 'Write your signature…' })
			],
			content: initialHtml || '',
			editorProps: {
				attributes: {
					class: 'sig-body',
					role: 'textbox',
					'aria-label': 'Signature body',
					tabindex: '0'
				}
			},
			onUpdate({ editor: ed }) {
				suppress = true;
				const html = ed.getHTML();
				onChange({ bodyHtml: html, appendOnReply });
				suppress = false;
			}
		});
		editor = e;
		return () => {
			editor = null;
			e.destroy();
		};
	});

	$effect(() => {
		const next = bodyHtml;
		if (!editor) return;
		if (suppress) return;
		if (editor.getHTML() === next) return;
		editor.commands.setContent(next || '', { emitUpdate: false });
	});

	$effect(() => {
		void addressId;
		void editor;
		void bodyHtml;
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	function toggleBold() {
		editor?.chain().focus().toggleBold().run();
	}
	function toggleItalic() {
		editor?.chain().focus().toggleItalic().run();
	}
	function toggleCode() {
		editor?.chain().focus().toggleCode().run();
	}
	function setLink() {
		if (!editor) return;
		const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
		const url = window.prompt('Link URL', prev);
		editor.commands.focus();
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		const normalized = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
		editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
	}

	function pickImage() {
		imageError = null;
		fileInputRef?.click();
	}

	async function onImagePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !editor) return;
		if (!ACCEPTED.includes(file.type)) {
			imageError = 'Use a JPG, PNG, GIF, or WebP image.';
			return;
		}
		if (file.size > MAX_BYTES) {
			imageError = `Maximum size is ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`;
			return;
		}
		imageBusy = true;
		try {
			const grant = await requestSignatureImageUploadUrl();
			const put = await platform.blobPut(grant.uploadUrl, file, file.type);
			if (!put.ok) throw new Error(`upload failed (${put.status})`);
			const img = await commitSignatureImage(grant.objectKey);
			signatures.cacheImage(img.objectKey, file, img.contentType);
			const dl = await getSignatureImageDownloadUrl(img.objectKey);
			editor
				.chain()
				.focus()
				.insertContent({
					type: 'image',
					attrs: {
						src: dl.downloadUrl,
						'data-thelemail-sig-image': img.objectKey,
						alt: ''
					}
				})
				.run();
		} catch (err) {
			imageError = err instanceof Error ? err.message : 'Could not insert image';
		} finally {
			imageBusy = false;
		}
	}
</script>

<div class="sig-tools">
	<button type="button" title="Bold" onclick={toggleBold}><Bold size={16} /></button>
	<button type="button" title="Italic" onclick={toggleItalic}><Italic size={16} /></button>
	<button type="button" title="Link" onclick={setLink}><LinkIcon size={16} /></button>
	<span class="divr"></span>
	<button type="button" title="Insert image" onclick={pickImage} disabled={imageBusy}>
		{#if imageBusy}<Loader2 size={16} class="spin" />{:else}<ImageIcon size={16} />{/if}
	</button>
	<button type="button" title="Inline code" onclick={toggleCode}><Code size={16} /></button>
</div>
<input
	bind:this={fileInputRef}
	type="file"
	accept="image/jpeg,image/png,image/gif,image/webp"
	onchange={onImagePicked}
	class="hidden-input"
/>
<div bind:this={mountEl} class="sig-edit-mount"></div>
{#if imageError}
	<div class="sig-error">{imageError}</div>
{/if}

<style>
	.sig-edit-mount {
		min-height: 130px;
		padding: 12px 14px;
		background: var(--paper-50, #fbf6e8);
		border: 1px solid var(--paper-200, #d6cbb6);
		border-radius: 8px;
		font-size: 14px;
		line-height: 1.55;
	}
	.sig-edit-mount :global(.sig-body) {
		outline: none;
		min-height: 130px;
	}
	.sig-edit-mount :global(.sig-body p) {
		margin: 0 0 8px;
	}
	.sig-edit-mount :global(.sig-body p:last-child) {
		margin-bottom: 0;
	}
	.sig-edit-mount :global(.sig-img) {
		max-width: 100%;
		height: auto;
	}
	.sig-edit-mount :global(.sig-body a) {
		color: var(--link, #2b5aa3);
		text-decoration: underline;
	}
	.hidden-input {
		display: none;
	}
	.sig-error {
		color: var(--warn, #b25030);
		margin-top: 6px;
		font-size: 12.5px;
	}
</style>
