<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import X from '@lucide/svelte/icons/x';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Attachment } from './attachmentUpload';
	import { canPreview, fileKind } from './previewKind';
	import AttachmentViewer, { type PreviewItem } from './AttachmentViewer.svelte';

	interface Props {
		files: Attachment[];
		onRemove?: (id: string) => void;
	}

	let { files, onRemove }: Props = $props();

	function formatSize(n: number): string {
		if (n < 1024) return m.mail_size_bytes({ size: n });
		if (n < 1024 * 1024) return m.mail_size_kb({ size: (n / 1024).toFixed(0) });
		return m.mail_size_mb({ size: (n / (1024 * 1024)).toFixed(1) });
	}

	const previewItems = $derived<PreviewItem[]>(
		files
			.filter((a) => canPreview(a.file.type, a.file.name, a.file.size))
			.map((a) => ({ kind: 'local', id: a.id, file: a.file }))
	);

	let viewing = $state<number | null>(null);

	function open(id: string) {
		const at = previewItems.findIndex((it) => it.id === id);
		if (at >= 0) viewing = at;
	}

	const previewUrls = new SvelteMap<string, string>();

	$effect(() => {
		const ids = new Set(files.map((a) => a.id));
		for (const a of files) {
			if (!previewUrls.has(a.id) && a.file.type.startsWith('image/')) {
				previewUrls.set(a.id, URL.createObjectURL(a.file));
			}
		}
		for (const id of [...previewUrls.keys()]) {
			if (!ids.has(id)) {
				const url = previewUrls.get(id);
				if (url) URL.revokeObjectURL(url);
				previewUrls.delete(id);
			}
		}
	});

	$effect(() => {
		return () => {
			for (const url of previewUrls.values()) URL.revokeObjectURL(url);
			previewUrls.clear();
		};
	});
</script>

{#if files.length > 0}
	<div class="att-preview">
		<div class="apv-head">
			<Paperclip size={13} />
			{m.mail_attach_count({ count: files.length })}
		</div>
		<div class="apv-grid">
			{#each files as a (a.id)}
				{@const k = fileKind(a.file.name)}
				{@const url = previewUrls.get(a.id)}
				{@const Ic = k.icon}
				{@const canOpen = canPreview(a.file.type, a.file.name, a.file.size)}
				<div class="apv-card" class:open={canOpen} title={a.file.name}>
					<svelte:element
						this={canOpen ? 'button' : 'div'}
						class="apv-thumb k-{k.cls}"
						role={canOpen ? undefined : 'presentation'}
						type={canOpen ? 'button' : undefined}
						aria-label={canOpen ? `${m.mail_preview_open()}: ${a.file.name}` : undefined}
						onclick={canOpen ? () => open(a.id) : undefined}
					>
						{#if k.type === 'image' && url}
							<img src={url} alt={a.file.name} />
						{:else}
							<Ic size={24} />
							<span class="apv-ext">{k.ext || m.mail_attach_ext_fallback()}</span>
						{/if}
					</svelte:element>
					{#if a.status === 'encrypting' || a.status === 'uploading' || a.status === 'queued'}
						<div class="apv-bar">
							<div class="apv-bar-fill" style:width="{Math.round(a.progress * 100)}%"></div>
						</div>
					{/if}
					<div class="apv-info">
						<span class="apv-name">{a.file.name}</span>
						<span class="apv-size">{formatSize(a.file.size)}</span>
					</div>
					{#if a.status === 'error'}
						<div class="apv-err">{a.error ?? m.mail_attach_upload_failed()}</div>
					{/if}
					{#if onRemove}
						<button
							type="button"
							class="apv-rm"
							title={m.common_remove()}
							onclick={(e) => {
								e.stopPropagation();
								onRemove(a.id);
							}}
						>
							<X size={13} />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if viewing !== null && previewItems.length > 0}
	<AttachmentViewer items={previewItems} bind:index={() => viewing ?? 0, (v) => (viewing = v)} onClose={() => (viewing = null)} />
{/if}
