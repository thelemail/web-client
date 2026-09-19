<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { onDestroy, untrack } from 'svelte';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Code from '@lucide/svelte/icons/code';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import { Editor } from '@tiptap/core';
	import LinkDialog from '$core/mail/editor/LinkDialog.svelte';
	import { applyLink, currentLink } from '$core/mail/editor/link';
	import StarterKit from '@tiptap/starter-kit';
	import Underline from '@tiptap/extension-underline';
	import Link from '@tiptap/extension-link';
	import Placeholder from '@tiptap/extension-placeholder';
	import Seg from '../Seg.svelte';
	import SignatureSource from './SignatureSource.svelte';
	import { SignatureImage } from '$core/mail/editor/signatureImage';
	import { sanitizeSignatureHtml } from '$core/mail/render/sanitizeSignature';
	import {
		hostSignatureImages,
		uploadSignatureImage,
		ACCEPTED_IMAGE_TYPES,
		MAX_IMAGE_BYTES
	} from '$core/mail/signatureImages';
	import {
		detectSourceKind,
		renderSource,
		htmlToMarkdown
	} from '../signatureSource';
	import type { SignatureMode } from '$core/mail/signatureCrypto';

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
	let tearingDown = false;
	let notice = $state<string | null>(null);
	let pasteUndo = $state<string | null>(null);
	let fileInputRef: HTMLInputElement | undefined = $state();

	const modeOptions: { v: SignatureMode; l: string }[] = $derived([
		{ v: 'rich', l: m.settings_signature_mode_rich() },
		{ v: 'html', l: 'HTML' },
		{ v: 'markdown', l: 'Markdown' }
	]);

	const sourcePlaceholder = $derived(
		mode === 'markdown'
			? '**Ada Lovelace**\nAnalytical Engines — [thelemail.com](https://thelemail.com)'
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
				parts.push(m.settings_signature_images_copied({ count: res.hosted }));
			}
			if (res.failed > 0) {
				parts.push(m.settings_signature_images_failed({ count: res.failed }));
			}
			notice = parts.join(' · ');
		}
		emit({ mode: nextMode, source: nextSource, bodyHtml: res.html });
		return res.html;
	}

	$effect(() => {
		if (mode !== 'rich') {
			if (editor) {
				tearingDown = true;
				editor.destroy();
				editor = null;
				tearingDown = false;
			}
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
				Placeholder.configure({ placeholder: m.settings_signature_placeholder() })
			],
			content: initialHtml || '',
			editorProps: {
				attributes: {
					class: 'sig-body',
					role: 'textbox',
					'aria-label': m.settings_signature_body_label(),
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
				if (tearingDown || mode !== 'rich') return;
				suppress = true;
				const html = ed.getHTML();
				emit({ mode: 'rich', source: html, bodyHtml: html });
				suppress = false;
			}
		});
		editor = e;
		return () => {
			tearingDown = true;
			editor = null;
			e.destroy();
			tearingDown = false;
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

	let linkInitial = $state<string | null>(null);

	function setLink() {
		if (!editor) return;
		linkInitial = currentLink(editor);
	}

	function closeLink() {
		linkInitial = null;
		editor?.commands.focus();
	}

	function submitLink(url: string) {
		linkInitial = null;
		if (editor) applyLink(editor, url);
	}

	function pickImage() {
		notice = null;
		fileInputRef?.click();
	}

	async function insertImageFile(file: File) {
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
			notice = m.settings_signature_image_type();
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			notice = m.settings_signature_image_size({ size: (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0) });
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
			notice = err instanceof Error ? err.message : m.settings_signature_image_failed();
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
		<LockKeyhole size={14} />{m.settings_signature_locked()}
	</div>
{/if}

{#if mode === 'rich'}
	<div class="sig-tools">
		<button type="button" title={m.settings_signature_bold()} onclick={toggleBold} disabled={locked}><Bold size={16} /></button>
		<button type="button" title={m.settings_signature_italic()} onclick={toggleItalic} disabled={locked}><Italic size={16} /></button>
		<button type="button" title={m.settings_signature_link()} onclick={setLink} disabled={locked}><LinkIcon size={16} /></button>
		<span class="divr"></span>
		<button type="button" title={m.settings_signature_insert_image()} onclick={pickImage} disabled={imageBusy || locked}>
			{#if imageBusy}<Loader2 size={16} class="spin" />{:else}<ImageIcon size={16} />{/if}
		</button>
		<button type="button" title={m.settings_signature_inline_code()} onclick={toggleCode} disabled={locked}><Code size={16} /></button>
	</div>
	<div bind:this={mountEl} class="sig-edit-mount"></div>
{:else}
	<div class="sig-tools">
		<button type="button" title={m.settings_signature_insert_image()} onclick={pickImage} disabled={imageBusy || locked}>
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
		{m.settings_signature_pasted()}
		<button type="button" class="linky" onclick={undoPaste}>{m.settings_signature_undo()}</button>
	</div>
{/if}
{#if notice}
	<div class="sig-note">{notice}</div>
{/if}

{#if linkInitial !== null}
	<LinkDialog initial={linkInitial} onApply={submitLink} onClose={closeLink} />
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
