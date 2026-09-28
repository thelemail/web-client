<script lang="ts" module>
	import type { AttachmentChip, PointerRefresh } from './attachments';
	import type { DecryptedAttachmentHeader } from '$core/mail/attframe';

	export type PreviewItem =
		| {
				kind: 'remote';
				id: string;
				chip: AttachmentChip;
				header: DecryptedAttachmentHeader;
				refresh?: PointerRefresh;
		  }
		| { kind: 'local'; id: string; file: File };
</script>

<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { Portal } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import Download from '@lucide/svelte/icons/download';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$core/components/ui/button';
	import { auth } from '$core/stores/auth.svelte';
	import { AttachmentError, downloadAttachment, loadAttachmentBytes } from './attachments';
	import {
		PREVIEW_MAX_BYTES,
		fileKind,
		previewKind,
		previewMimeType,
		type PreviewKind
	} from './previewKind';
	import type { PdfFailure } from './pdf';
	import PdfPages from './PdfPages.svelte';
	import { untrack } from 'svelte';

	interface Props {
		items: PreviewItem[];
		index: number;
		onClose: () => void;
	}

	let { items, index = $bindable(), onClose }: Props = $props();

	type View =
		| { status: 'loading' }
		| { status: 'image'; url: string }
		| { status: 'text'; text: string }
		| { status: 'pdf'; blob: Blob }
		| { status: 'unsupported' | 'too_large' | 'password' | 'failed' }
		| { status: 'error'; message: string };

	let view = $state<View>({ status: 'loading' });
	let pdfReady = $state(false);
	let downloading = $state(false);
	let attempt = $state(0);
	let actualSize = $state(false);
	let modal: HTMLDivElement | undefined = $state();

	const item = $derived(items[Math.min(Math.max(index, 0), items.length - 1)]);
	const name = $derived(item.kind === 'local' ? item.file.name : item.header.filename || 'attachment');
	const type = $derived(item.kind === 'local' ? item.file.type : item.header.contentType);
	const size = $derived(item.kind === 'local' ? item.file.size : item.header.plaintextSize);
	const kind = $derived(fileKind(name));
	const key = $derived(item.id);

	function sizeLabel(n: number): string {
		if (n >= 1024 * 1024) return m.mail_size_mb({ size: (n / (1024 * 1024)).toFixed(1) });
		if (n >= 1024) return m.mail_size_kb({ size: (n / 1024).toFixed(1) });
		return m.mail_size_bytes({ size: n });
	}

	function errorText(err: unknown): string {
		if (err instanceof AttachmentError) {
			switch (err.code) {
				case 'locked':
					return m.mail_attach_err_locked();
				case 'network':
					return m.mail_attach_err_network();
				case 'no_matching_key':
					return m.mail_attach_err_no_key();
				case 'invalid_ciphertext':
					return m.mail_attach_err_damaged();
				default:
					return m.mail_attach_err_decrypt();
			}
		}
		return m.mail_preview_failed();
	}

	async function bytesOf(current: PreviewItem): Promise<Blob> {
		if (current.kind === 'local') return current.file;
		const accountId = auth.accountId;
		if (!accountId) throw new AttachmentError('locked');
		const dec = await loadAttachmentBytes(accountId, current.chip, current.refresh);
		return dec.blob;
	}

	$effect(() => {
		void key;
		void attempt;
		const current = untrack(() => item);
		const preview: PreviewKind | null = untrack(() => previewKind(type, name));
		const bytes = untrack(() => size);
		let cancelled = false;
		let url: string | null = null;
		pdfReady = false;
		actualSize = false;

		if (!preview) {
			view = { status: 'unsupported' };
			return;
		}
		if (bytes > PREVIEW_MAX_BYTES[preview]) {
			view = { status: 'too_large' };
			return;
		}
		view = { status: 'loading' };
		void (async () => {
			try {
				const blob = await bytesOf(current);
				if (cancelled) return;
				if (blob.size > PREVIEW_MAX_BYTES[preview]) {
					view = { status: 'too_large' };
				} else if (preview === 'image') {
					url = URL.createObjectURL(
						blob.slice(0, blob.size, untrack(() => previewMimeType('image', type, name)))
					);
					view = { status: 'image', url };
				} else if (preview === 'text') {
					const text = await blob.text();
					if (!cancelled) view = { status: 'text', text };
				} else {
					view = { status: 'pdf', blob };
				}
			} catch (err) {
				if (!cancelled) view = { status: 'error', message: errorText(err) };
			}
		})();
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	});

	function pdfFailed(reason: PdfFailure) {
		view = { status: reason };
	}

	async function download() {
		if (item.kind !== 'remote' || downloading) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		downloading = true;
		try {
			await downloadAttachment(accountId, item.chip, item.refresh);
		} catch (err) {
			view = { status: 'error', message: errorText(err) };
		} finally {
			downloading = false;
		}
	}

	function step(delta: number) {
		if (items.length < 2) return;
		index = (index + delta + items.length) % items.length;
	}

	function focusables(): HTMLElement[] {
		if (!modal) return [];
		return [
			...modal.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
			)
		];
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			e.preventDefault();
			onClose();
		} else if (
			(e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
			items.length > 1 &&
			!e.altKey &&
			!e.metaKey &&
			!e.ctrlKey
		) {
			e.stopPropagation();
			e.preventDefault();
			step(e.key === 'ArrowLeft' ? -1 : 1);
		} else if (e.key === 'Tab') {
			const list = focusables();
			if (list.length === 0) return;
			const first = list[0];
			const last = list[list.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && (active === first || !modal?.contains(active))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (active === last || !modal?.contains(active))) {
				e.preventDefault();
				first.focus();
			}
		} else {
			e.stopPropagation();
		}
	}

	$effect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		modal?.focus();
		return () => previous?.focus();
	});

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:document onkeydowncapture={handleKey} />

<Portal>
	<div class="apx-scrim" role="presentation" onmousedown={scrimMouseDown}>
		<div
			class="apx-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="apx-title"
			tabindex="-1"
			bind:this={modal}
		>
			<div class="apx-head">
				<span class="apx-ic k-{kind.cls}"><kind.icon size={17} /></span>
				<div class="apx-tx">
					<h2 class="apx-title" id="apx-title" title={name}>{name}</h2>
					<div class="apx-sub">
						{sizeLabel(size)}
						{#if items.length > 1}
							<span class="apx-dot">·</span>{m.mail_preview_position({ index: index + 1, total: items.length })}
						{/if}
					</div>
				</div>
				{#if items.length > 1}
					<button type="button" class="apx-x" title={m.mail_preview_prev()} onclick={() => step(-1)}>
						<ChevronLeft size={17} />
					</button>
					<button type="button" class="apx-x" title={m.mail_preview_next()} onclick={() => step(1)}>
						<ChevronRight size={17} />
					</button>
				{/if}
				{#if item.kind === 'remote'}
					<Button variant="secondary" size="sm" disabled={downloading} onclick={download}>
						{#if downloading}
							<LoaderCircle size={14} class="apx-spin" />{m.mail_attach_downloading()}
						{:else}
							<Download size={14} />{m.mail_attach_download()}
						{/if}
					</Button>
				{/if}
				<button type="button" class="apx-x" title={m.common_close()} onclick={onClose}>
					<X size={17} />
				</button>
			</div>

			<div class="apx-body" class:on-image={view.status === 'image'}>
				{#if view.status === 'loading' || (view.status === 'pdf' && !pdfReady)}
					<div class="apx-note"><LoaderCircle size={18} class="apx-spin" />{m.mail_preview_loading()}</div>
				{/if}
				{#if view.status === 'image'}
					<button
						type="button"
						class="apx-img"
						class:actual={actualSize}
						title={actualSize ? m.mail_preview_fit() : m.mail_preview_actual_size()}
						onclick={() => (actualSize = !actualSize)}
					>
						<img src={view.url} alt={name} />
					</button>
				{:else if view.status === 'text'}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre class="apx-text" tabindex="0" role="region" aria-label={name}>{view.text}</pre>
				{:else if view.status === 'pdf'}
					<PdfPages blob={view.blob} onReady={() => (pdfReady = true)} onFail={pdfFailed} />
				{:else if view.status === 'error'}
					<div class="apx-note err" role="alert">
						{view.message}
						<Button variant="secondary" size="sm" onclick={() => (attempt += 1)}>{m.common_retry()}</Button>
					</div>
				{:else if view.status !== 'loading'}
					<div class="apx-note">
						{view.status === 'too_large'
							? m.mail_preview_too_large()
							: view.status === 'password'
								? m.mail_preview_pdf_password()
								: view.status === 'failed'
									? m.mail_preview_failed()
									: m.mail_preview_unsupported()}
					</div>
				{/if}
			</div>
		</div>
	</div>
</Portal>
