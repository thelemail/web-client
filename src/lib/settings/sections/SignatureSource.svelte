<script lang="ts">
	import { signatures } from '$lib/stores/signatures.svelte';
	import { SIGNATURE_IMAGE_ATTR } from '$lib/mail/editor/signatureImage';

	interface Props {
		value: string;
		placeholder: string;
		previewHtml: string;
		disabled?: boolean;
		onChange: (next: string) => void;
	}

	let { value, placeholder, previewHtml, disabled = false, onChange }: Props = $props();

	let previewEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		const html = previewHtml;
		const el = previewEl;
		if (!el) return;
		el.innerHTML = html;
		for (const img of Array.from(el.querySelectorAll<HTMLImageElement>(`img[${SIGNATURE_IMAGE_ATTR}]`))) {
			const key = img.getAttribute(SIGNATURE_IMAGE_ATTR);
			if (!key) continue;
			const cached = signatures.objectUrl(key);
			if (cached) {
				img.src = cached;
				continue;
			}
			void signatures
				.ensureObjectUrl(key)
				.then((url) => {
					img.src = url;
				})
				.catch(() => {});
		}
	});
</script>

<textarea
	class="sig-source"
	spellcheck="false"
	{placeholder}
	{disabled}
	value={value}
	oninput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
></textarea>
<div class="sig-preview-lbl">Preview</div>
<div bind:this={previewEl} class="sig-preview"></div>

<style>
	.sig-source {
		width: 100%;
		min-height: 150px;
		padding: 12px 14px;
		background: var(--paper-50, #fbf6e8);
		border: 1px solid var(--paper-200, #d6cbb6);
		border-radius: 8px;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--fg, #1f221b);
		resize: vertical;
	}
	.sig-source:focus {
		outline: 2px solid var(--ring, #7d8a5c);
		outline-offset: -1px;
	}
	.sig-preview-lbl {
		margin: 12px 0 6px;
		font-size: 11.5px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--fg-faint, #9a8f7d);
	}
	.sig-preview {
		min-height: 60px;
		padding: 12px 14px;
		border: 1px dashed var(--paper-200, #d6cbb6);
		border-radius: 8px;
		font-size: 14px;
		line-height: 1.55;
		overflow-x: auto;
	}
	.sig-preview :global(img) {
		max-width: 100%;
		height: auto;
	}
	.sig-preview :global(a) {
		color: var(--link, #2b5aa3);
		text-decoration: underline;
	}
	.sig-preview :global(p) {
		margin: 0 0 8px;
	}
	.sig-preview :global(p:last-child) {
		margin-bottom: 0;
	}
	.sig-preview :global(table) {
		border-collapse: collapse;
	}
</style>
