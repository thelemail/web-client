import Image from '@lucide/svelte/icons/image';
import FileText from '@lucide/svelte/icons/file-text';
import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
import MonitorPlay from '@lucide/svelte/icons/monitor-play';
import FileArchive from '@lucide/svelte/icons/file-archive';
import FileVideo from '@lucide/svelte/icons/file-video';
import FileAudio from '@lucide/svelte/icons/file-audio';
import File from '@lucide/svelte/icons/file';
import type { Component } from 'svelte';

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'tif', 'tiff'];
const DOC_EXT = ['doc', 'docx', 'rtf', 'txt', 'md', 'pages'];
const SHEET_EXT = ['xls', 'xlsx', 'csv', 'numbers'];
const SLIDES_EXT = ['ppt', 'pptx', 'key'];
const ZIP_EXT = ['zip', 'rar', '7z', 'tar', 'gz'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg'];

export interface FileKind {
	ext: string;
	type: 'image' | 'file';
	icon: Component;
	cls: string;
}

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(name: string): FileKind {
	const ext = extensionOf(name);
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

export type PreviewKind = 'image' | 'pdf' | 'text';

const IMAGE_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/pjpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/x-ms-bmp': 'bmp',
	'image/svg+xml': 'svg',
	'image/x-icon': 'ico',
	'image/vnd.microsoft.icon': 'ico'
};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']);

const TEXT_TYPES = new Set([
	'application/json',
	'application/ld+json',
	'application/xml',
	'application/x-yaml',
	'application/yaml',
	'application/toml',
	'application/x-sh',
	'application/sql',
	'application/javascript',
	'application/x-subrip',
	'application/pgp-keys',
	'application/pgp-signature'
]);
const TEXT_EXT = new Set([
	'txt', 'text', 'log', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml',
	'ini', 'cfg', 'conf', 'env', 'sql', 'sh', 'js', 'ts', 'css', 'py', 'go', 'rs', 'java', 'c',
	'h', 'cpp', 'rb', 'php', 'swift', 'kt', 'srt', 'vtt', 'ics', 'vcf', 'asc', 'diff', 'patch'
]);

export const PREVIEW_MAX_BYTES: Record<PreviewKind, number> = {
	image: 25 * 1024 * 1024,
	pdf: 25 * 1024 * 1024,
	text: 2 * 1024 * 1024
};

function baseType(contentType: string): string {
	return contentType.split(';')[0].trim().toLowerCase();
}

function kindFromExt(ext: string): PreviewKind | null {
	if (IMAGE_EXT.has(ext)) return 'image';
	if (ext === 'pdf') return 'pdf';
	if (TEXT_EXT.has(ext)) return 'text';
	return null;
}

export function previewKind(contentType: string, filename: string): PreviewKind | null {
	const type = baseType(contentType);
	if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
		if (type in IMAGE_TYPES) return 'image';
		if (type.startsWith('image/')) return null;
		if (type === 'application/pdf' || type === 'application/x-pdf') return 'pdf';
		if (type === 'text/html') return null;
		if (type.startsWith('text/') || TEXT_TYPES.has(type) || type.endsWith('+json') || type.endsWith('+xml')) {
			return 'text';
		}
		const byExt = kindFromExt(extensionOf(filename));
		return byExt === 'text' ? null : byExt;
	}
	return kindFromExt(extensionOf(filename));
}

export function previewMimeType(kind: PreviewKind, contentType: string, filename: string): string {
	const type = baseType(contentType);
	if (kind === 'pdf') return 'application/pdf';
	if (kind === 'text') return 'text/plain';
	if (type in IMAGE_TYPES) return type;
	const ext = extensionOf(filename);
	if (ext === 'svg') return 'image/svg+xml';
	if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return 'image/jpeg';
	if (ext === 'ico') return 'image/x-icon';
	return `image/${ext}`;
}

export function canPreview(contentType: string, filename: string, size: number): boolean {
	const kind = previewKind(contentType, filename);
	return kind !== null && size <= PREVIEW_MAX_BYTES[kind];
}
