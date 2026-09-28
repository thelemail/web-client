<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Download from '@lucide/svelte/icons/download';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import {
		AttachmentError,
		downloadAttachment,
		loadAttachmentHeader,
		type AttachmentChip,
		type PointerRefresh
	} from './attachments';
	import type { DecryptedAttachmentHeader } from '$core/mail/attframe';
	import { auth } from '$core/stores/auth.svelte';
	import { canPreview, fileKind } from './previewKind';
	import AttachmentViewer, { type PreviewItem } from './AttachmentViewer.svelte';

	interface Props {
		chips: AttachmentChip[];
		refresh?: PointerRefresh;
	}

	let { chips, refresh }: Props = $props();

	type ChipState =
		| { kind: 'loading' }
		| { kind: 'ready'; header: DecryptedAttachmentHeader }
		| { kind: 'downloading'; header: DecryptedAttachmentHeader }
		| { kind: 'error'; message: string };

	let states = $state<Record<string, ChipState>>({});

	function messageFor(err: unknown): string {
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
		return err instanceof Error ? err.message : m.mail_attach_err_decrypt();
	}

	async function hydrate(chip: AttachmentChip) {
		const accountId = auth.accountId;
		states = { ...states, [chip.id]: { kind: 'loading' } };
		try {
			if (!accountId) throw new AttachmentError('locked');
			const header = await loadAttachmentHeader(accountId, chip, refresh);
			states = { ...states, [chip.id]: { kind: 'ready', header } };
		} catch (err) {
			states = { ...states, [chip.id]: { kind: 'error', message: messageFor(err) } };
		}
	}

	$effect(() => {
		for (const chip of chips) {
			if (!states[chip.id]) void hydrate(chip);
		}
	});

	async function download(chip: AttachmentChip) {
		const current = states[chip.id];
		if (current?.kind !== 'ready') return;
		const accountId = auth.accountId;
		states = { ...states, [chip.id]: { kind: 'downloading', header: current.header } };
		try {
			if (!accountId) throw new AttachmentError('locked');
			const header = await downloadAttachment(accountId, chip, refresh);
			states = { ...states, [chip.id]: { kind: 'ready', header } };
		} catch (err) {
			states = { ...states, [chip.id]: { kind: 'error', message: messageFor(err) } };
		}
	}

	function previewable(header: DecryptedAttachmentHeader): boolean {
		return canPreview(header.contentType, header.filename, header.plaintextSize);
	}

	const previewItems = $derived.by(() => {
		const out: PreviewItem[] = [];
		for (const chip of chips) {
			const s = states[chip.id];
			if ((s?.kind === 'ready' || s?.kind === 'downloading') && previewable(s.header)) {
				out.push({ kind: 'remote', id: chip.id, chip, header: s.header, refresh });
			}
		}
		return out;
	});

	let viewing = $state<number | null>(null);

	function open(chip: AttachmentChip) {
		const at = previewItems.findIndex((it) => it.id === chip.id);
		if (at >= 0) viewing = at;
	}

	function sizeOf(chip: AttachmentChip): string {
		const s = states[chip.id];
		const n =
			s?.kind === 'ready' || s?.kind === 'downloading'
				? s.header.plaintextSize
				: chip.pointer.sizeBytes;
		if (n >= 1024 * 1024) return m.mail_size_mb({ size: (n / (1024 * 1024)).toFixed(1) });
		if (n >= 1024) return m.mail_size_kb({ size: (n / 1024).toFixed(1) });
		return m.mail_size_bytes({ size: n });
	}
</script>

{#if chips.length > 0}
	<div class="att-row">
		<div class="att-h">
			<Paperclip size={14} />{m.mail_attach_count({ count: chips.length })}
		</div>
		<div class="att-list">
			{#each chips as chip (chip.id)}
				{@const s = states[chip.id] ?? { kind: 'loading' }}
				{@const Ic = s.kind === 'ready' || s.kind === 'downloading' ? fileKind(s.header.filename).icon : null}
				{@const canOpen = (s.kind === 'ready' || s.kind === 'downloading') && previewable(s.header)}
				<div class="att-card" class:err={s.kind === 'error'} class:open={canOpen}>
					<svelte:element
						this={canOpen ? 'button' : 'div'}
						class="att-main"
						role={canOpen ? undefined : 'presentation'}
						type={canOpen ? 'button' : undefined}
						title={canOpen ? m.mail_preview_open() : undefined}
						onclick={canOpen ? () => open(chip) : undefined}
					>
						<div class="ic">
							{#if Ic}<Ic size={19} />{:else}<Paperclip size={19} />{/if}
						</div>
						<div class="info">
							{#if s.kind === 'ready' || s.kind === 'downloading'}
								<div class="nm" title={s.header.filename}>{s.header.filename}</div>
								<div class="sz">{sizeOf(chip)}</div>
							{:else if s.kind === 'error'}
								<div class="nm">{s.message}</div>
								<div class="sz">{sizeOf(chip)}</div>
							{:else}
								<div class="nm-skel"></div>
								<div class="sz-skel"></div>
							{/if}
						</div>
					</svelte:element>
					{#if s.kind === 'error'}
						<button type="button" class="dl" title={m.common_retry()} onclick={() => hydrate(chip)}>
							<RotateCw size={16} />
						</button>
					{:else}
						<button
							type="button"
							class="dl"
							class:busy={s.kind === 'downloading'}
							title={s.kind === 'downloading' ? m.mail_attach_downloading() : m.mail_attach_download()}
							disabled={s.kind !== 'ready'}
							onclick={() => download(chip)}
						>
							<Download size={16} />
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
