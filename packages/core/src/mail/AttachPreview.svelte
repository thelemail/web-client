<script lang="ts">
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import X from '@lucide/svelte/icons/x';
	import Image from '@lucide/svelte/icons/image';
	import FileText from '@lucide/svelte/icons/file-text';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import MonitorPlay from '@lucide/svelte/icons/monitor-play';
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import FileVideo from '@lucide/svelte/icons/file-video';
	import FileAudio from '@lucide/svelte/icons/file-audio';
	import File from '@lucide/svelte/icons/file';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Component } from 'svelte';
	import type { Attachment } from './attachmentUpload';

	interface Props {
		files: Attachment[];
		onRemove?: (id: string) => void;
	}

	let { files, onRemove }: Props = $props();

	const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'tif', 'tiff'];
	const DOC_EXT = ['doc', 'docx', 'rtf', 'txt', 'md', 'pages'];
	const SHEET_EXT = ['xls', 'xlsx', 'csv', 'numbers'];
	const SLIDES_EXT = ['ppt', 'pptx', 'key'];
	const ZIP_EXT = ['zip', 'rar', '7z', 'tar', 'gz'];
	const VIDEO_EXT = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
	const AUDIO_EXT = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg'];

	interface FileKind {
		ext: string;
		type: 'image' | 'file';
		icon: Component;
		cls: string;
	}

	function fileKind(name: string): FileKind {
		const ext = (name.split('.').pop() ?? '').toLowerCase();
		if (IMG_EXT.includes(ext)) return { ext, type: 'image', icon: Image, cls: 'img' };
		if (ext === 'pdf') return { ext, type: 'file', icon: FileText, cls: 'pdf' };
		if (DOC_EXT.includes(ext)) return { ext, type: 'file', icon: FileText, cls: 'doc' };
		if (SHEET_EXT.includes(ext)) return { ext, type: 'file', icon: FileSpreadsheet, cls: 'sheet' };
		if (SLIDES_EXT.includes(ext)) return { ext, type: 'file', icon: MonitorPlay, cls: 'slides' };
		if (ZIP_EXT.includes(ext)) return { ext, type: 'file', icon: FileArchive, cls: 'zip' };
		if (VIDEO_EXT.includes(ext)) return { ext, type: 'file', icon: FileVideo, cls: 'video' };
		if (AUDIO_EXT.includes(ext)) return { ext, type: 'file', icon: FileAudio, cls: 'audio' };
		return { ext, type: 'file', icon: File, cls: 'file' };
	}

	function formatSize(n: number): string {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
		return (n / (1024 * 1024)).toFixed(1) + ' MB';
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
			{files.length} attachment{files.length > 1 ? 's' : ''}
		</div>
		<div class="apv-grid">
			{#each files as a (a.id)}
				{@const k = fileKind(a.file.name)}
				{@const url = previewUrls.get(a.id)}
				{@const Ic = k.icon}
				<div class="apv-card" title={a.file.name}>
					<div class="apv-thumb k-{k.cls}">
						{#if k.type === 'image' && url}
							<img src={url} alt={a.file.name} />
						{:else}
							<Ic size={24} />
							<span class="apv-ext">{k.ext || 'file'}</span>
						{/if}
					</div>
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
						<div class="apv-err">{a.error ?? 'Upload failed'}</div>
					{/if}
					{#if onRemove}
						<button
							type="button"
							class="apv-rm"
							title="Remove"
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
