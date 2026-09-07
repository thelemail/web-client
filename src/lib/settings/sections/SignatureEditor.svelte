<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Code from '@lucide/svelte/icons/code';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Underline from '@tiptap/extension-underline';
	import Link from '@tiptap/extension-link';
	import Placeholder from '@tiptap/extension-placeholder';
	import Seg from '../Seg.svelte';
	import SignatureSource from './SignatureSource.svelte';
	import { SignatureImage } from '$lib/mail/editor/signatureImage';
	import { sanitizeSignatureHtml } from '$lib/mail/render/sanitizeSignature';
	import {
		hostSignatureImages,
		uploadSignatureImage,
		ACCEPTED_IMAGE_TYPES,
		MAX_IMAGE_BYTES
	} from '$lib/mail/signatureImages';
	import {
		detectSourceKind,
		renderSource,
		htmlToMarkdown
	} from '../signatureSource';
	import type { SignatureMode } from '$lib/mail/signatureCrypto';

	interface Props {
		addressId: string;
		mode: SignatureMode;
		source: string;
		bodyHtml: string;
		locked?: boolean;
		onChange: (next: { mode: SignatureMode; source: string; bodyHtml: string }) => void;
	}

	let { addressId, mode, source, bodyHtml, locked = false, onChange }: Props = $props();

	let mountEl: HTMLDivElement | undefined = $state();
	let editor: Editor | null = $state(null);
	let suppress = false;
	let imageBusy = $state(false);
	let notice = $state<string | null>(null);
	let pasteUndo = $state<string | null>(null);
	let fileInputRef: HTMLInputElement | undefined = $state();

	const modeOptions: { v: SignatureMode; l: string }[] = [
		{ v: 'rich', l: 'Rich' },
		{ v: 'html', l: 'HTML' },
		{ v: 'markdown', l: 'Markdown' }
	];

	const sourcePlaceholder = $derived(
		mode === 'markdown'
			? '**Ada Lovelace**\nAnalytical Engines — [example.com](https://example.com)'
			: '<p><strong>Ada Lovelace</strong></p>'
	);

	function emit(next: Partial<{ mode: SignatureMode; source: string; bodyHtml: string }>) {
		onChange({
			mode: next.mode ?? mode,
			source: next.source ?? source,
			bodyHtml: next.bodyHtml ?? bodyHtml
		});
	}

	async function adoptHtml(rawHtml: string, nextMode: SignatureMode, nextSource: string) {
		const clean = sanitizeSignatureHtml(rawHtml, { keepRemoteImages: true });
		const res = await hostSignatureImages(addressId, clean);
		if (res.hosted > 0 || res.failed > 0) {
			const parts: string[] = [];
			if (res.hosted > 0) {
				parts.push(`${res.hosted} image${res.hosted === 1 ? '' : 's'} copied to Thelemail`);
			}
			if (res.failed > 0) {
				parts.push(`${res.failed} could not be added`);
			}
			notice = parts.join(' · ');
		}
		emit({ mode: nextMode, source: nextSource, bodyHtml: res.html });
		return res.html;
	}

	$effect(() => {
		if (mode !== 'rich') {
			editor?.destroy();
			editor = null;
			return;
		}
		if (!mountEl) return;
		const initialHtml = untrack(() => bodyHtml);
		const editable = !untrack(() => locked);
		const e = new Editor({
			element: mountEl,
			editable,
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
				SignatureImage,
				Placeholder.configure({ placeholder: 'Write your signature…' })
			],
			content: initialHtml || '',
			editorProps: {
				attributes: {
					class: 'sig-body',
					role: 'textbox',
					'aria-label': 'Signature body',
					tabindex: '0'
				},
				handlePaste: (_view, event) => {
					const clip = event.clipboardData;
					if (!clip) return false;
					const files = Array.from(clip.files ?? []);
					const image = files.find((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
					if (image) {
						event.preventDefault();
						void insertImageFile(image);
						return true;
					}
					const html = clip.getData('text/html');
					if (html) {
						event.preventDefault();
						void adoptHtml(html, 'rich', html);
						return true;
					}
					const text = clip.getData('text/plain');
					if (!text) return false;
					const kind = detectSourceKind(text);
					if (kind === 'plain') return false;
					event.preventDefault();
					const previous = untrack(() => bodyHtml);
					const rendered = renderSource(kind === 'markdown' ? 'markdown' : 'html', text);
					void adoptHtml(rendered, 'rich', text).then(() => {
						pasteUndo = previous;
						window.setTimeout(() => {
							if (pasteUndo === previous) pasteUndo = null;
						}, 8000);
					});
					return true;
				}
			},
			onUpdate({ editor: ed }) {
				suppress = true;
				const html = ed.getHTML();
				emit({ mode: 'rich', source: html, bodyHtml: html });
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
		if (!editor || mode !== 'rich') return;
		if (suppress) return;
		if (editor.getHTML() === next) return;
		editor.commands.setContent(next || '', { emitUpdate: false });
	});

	$effect(() => {
		const isLocked = locked;
		editor?.setEditable(!isLocked);
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	function switchMode(next: SignatureMode) {
		if (next === mode) return;
		if (next === 'rich') {
			emit({ mode: 'rich', bodyHtml: renderSource(mode, source) });
			return;
		}
		if (next === 'markdown') {
			const md = mode === 'rich' ? htmlToMarkdown(bodyHtml) : source;
			emit({ mode: 'markdown', source: md, bodyHtml: renderSource('markdown', md) });
			return;
		}
		const html = mode === 'rich' ? bodyHtml : renderSource(mode, source);
		emit({ mode: 'html', source: html, bodyHtml: html });
	}

	function onSourceInput(next: string) {
		emit({ mode, source: next, bodyHtml: renderSource(mode, next) });
	}

	function undoPaste() {
		const previous = pasteUndo;
		if (previous === null) return;
		pasteUndo = null;
		notice = null;
		emit({ mode: 'rich', source: previous, bodyHtml: previous });
		editor?.commands.setContent(previous || '', { emitUpdate: false });
	}

	const toggleBold = () => editor?.chain().focus().toggleBold().run();
	const toggleItalic = () => editor?.chain().focus().toggleItalic().run();
	const toggleCode = () => editor?.chain().focus().toggleCode().run();

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
		notice = null;
		fileInputRef?.click();
	}

	async function insertImageFile(file: File) {
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
			notice = 'Use a JPG, PNG, GIF, or WebP image.';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			notice = `Maximum size is ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB.`;
			return;
		}
		imageBusy = true;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const hosted = await uploadSignatureImage(addressId, bytes, {
				filename: file.name || 'signature',
				contentType: file.type
			});
			if (mode === 'rich' && editor) {
				editor
					.chain()
					.focus()
					.insertContent({
						type: 'signatureImage',
						attrs: { objectKey: hosted.objectKey, alt: '' }
					})
					.run();
			} else {
				const tag = `<img data-thelemail-sig-image="${hosted.objectKey}" src="" alt="">`;
				onSourceInput(`${source}${source.endsWith('\n') || !source ? '' : '\n'}${tag}`);
			}
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Could not insert image';
		} finally {
			imageBusy = false;
		}
	}

	async function onImagePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await insertImageFile(file);
	}
</script>

<div class="sig-modes">
	<Seg value={mode} options={modeOptions} onChange={switchMode} />
</div>

{#if locked}
	<div class="sig-locked">
		<LockKeyhole size={14} />Unlock your vault to read and edit this signature.
	</div>
{/if}

{#if mode === 'rich'}
	<div class="sig-tools">
		<button type="button" title="Bold" onclick={toggleBold} disabled={locked}><Bold size={16} /></button>
		<button type="button" title="Italic" onclick={toggleItalic} disabled={locked}><Italic size={16} /></button>
		<button type="button" title="Link" onclick={setLink} disabled={locked}><LinkIcon size={16} /></button>
		<span class="divr"></span>
		<button type="button" title="Insert image" onclick={pickImage} disabled={imageBusy || locked}>
			{#if imageBusy}<Loader2 size={16} class="spin" />{:else}<ImageIcon size={16} />{/if}
		</button>
		<button type="button" title="Inline code" onclick={toggleCode} disabled={locked}><Code size={16} /></button>
	</div>
	<div bind:this={mountEl} class="sig-edit-mount"></div>
{:else}
	<div class="sig-tools">
		<button type="button" title="Insert image" onclick={pickImage} disabled={imageBusy || locked}>
			{#if imageBusy}<Loader2 size={16} class="spin" />{:else}<ImageIcon size={16} />{/if}
		</button>
	</div>
	<SignatureSource
		value={source}
		placeholder={sourcePlaceholder}
		previewHtml={bodyHtml}
		disabled={locked}
		onChange={onSourceInput}
	/>
{/if}

<input
	bind:this={fileInputRef}
	type="file"
	accept="image/jpeg,image/png,image/gif,image/webp"
	onchange={onImagePicked}
	class="hidden-input"
/>

{#if pasteUndo !== null}
	<div class="sig-note">
		Pasted as formatted text.
		<button type="button" class="linky" onclick={undoPaste}>Undo</button>
	</div>
{/if}
{#if notice}
	<div class="sig-note">{notice}</div>
{/if}

<style>
	.sig-modes {
		margin-bottom: 10px;
	}
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
	.sig-locked {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
		font-size: 12.5px;
		color: var(--fg-muted, #6b6455);
	}
	.sig-note {
		margin-top: 8px;
		font-size: 12.5px;
		color: var(--fg-muted, #6b6455);
	}
	.linky {
		background: none;
		border: none;
		padding: 0 0 0 4px;
		color: var(--link, #2b5aa3);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
