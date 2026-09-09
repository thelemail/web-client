<script lang="ts">
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import FileText from '@lucide/svelte/icons/file-text';
	import Download from '@lucide/svelte/icons/download';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import {
		AttachmentError,
		downloadAttachment,
		loadAttachmentHeader,
		type AttachmentChip,
		type PointerRefresh
	} from './attachments';
	import type { DecryptedAttachmentHeader } from './attframe';
	import { auth } from '$lib/stores/auth.svelte';

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
					return 'Vault is locked';
				case 'network':
					return 'Could not reach storage';
				case 'no_matching_key':
					return 'No key for this file';
				case 'invalid_ciphertext':
					return 'File is damaged';
				default:
					return 'Could not decrypt';
			}
		}
		return err instanceof Error ? err.message : 'Could not decrypt';
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

	function sizeOf(chip: AttachmentChip): string {
		const s = states[chip.id];
		const n =
			s?.kind === 'ready' || s?.kind === 'downloading'
				? s.header.plaintextSize
				: chip.pointer.sizeBytes;
		if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
		if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
		return n + ' B';
	}
</script>

{#if chips.length > 0}
	<div class="att-row">
		<div class="att-h">
			<Paperclip size={14} />{chips.length} attachment{chips.length > 1 ? 's' : ''}
		</div>
		<div class="att-list">
			{#each chips as chip (chip.id)}
				{@const s = states[chip.id] ?? { kind: 'loading' }}
				<div class="att-card" class:err={s.kind === 'error'}>
					<div class="ic"><FileText size={19} /></div>
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
					{#if s.kind === 'error'}
						<button type="button" class="dl" title="Try again" onclick={() => hydrate(chip)}>
							<RotateCw size={16} />
						</button>
					{:else}
						<button
							type="button"
							class="dl"
							class:busy={s.kind === 'downloading'}
							title={s.kind === 'downloading' ? 'Downloading…' : 'Download'}
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
