<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Shield from '@lucide/svelte/icons/shield';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import FileText from '@lucide/svelte/icons/file-text';
	import Download from '@lucide/svelte/icons/download';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import Avatar from './Avatar.svelte';
	import EmailBody from './EmailBody.svelte';
	import { formatWhenLong, type ThreadEntry } from './data';
	import { authBadgeTitle } from './preview';
	import {
		decryptAttachmentHeader,
		downloadAttachment,
		type AttachmentChip
	} from './attachments';
	import type { DecryptedAttachmentHeader } from './attframe';
	import { auth } from '$lib/stores/auth.svelte';
	import { bimi } from '$lib/stores/bimi.svelte';

	interface Props {
		e: ThreadEntry;
		isOpen: boolean;
		onToggle: () => void;
	}

	let { e, isOpen, onToggle }: Props = $props();

	let showQuoted = $state(false);
	$effect(() => {
		void isOpen;
		showQuoted = false;
	});

	const name = $derived(e.me ? 'You' : e.from);
	const when = $derived(formatWhenLong(new Date(e.epoch)));
	const shortWhen = $derived(when.replace('Today at ', '').replace('Yesterday at ', 'Yesterday '));

	const toLine = $derived.by(() => {
		const tos = (e.recipients ?? []).filter((r) => r.kind === 'to').map((r) => r.address);
		return tos.length ? tos.join(', ') : e.to;
	});
	const ccLine = $derived(
		(e.recipients ?? [])
			.filter((r) => r.kind === 'cc')
			.map((r) => r.address)
			.join(', ')
	);

	type ChipResult =
		| { state: 'ready'; header: DecryptedAttachmentHeader }
		| { state: 'error'; error: string };
	let hydrated = $state<Record<string, ChipResult>>({});
	const requested = new Set<string>();

	const chips = $derived(
		(e.attachments ?? []).map((c): AttachmentChip => {
			const h = hydrated[c.id];
			if (!h) return c;
			return h.state === 'ready'
				? { ...c, state: 'ready', header: h.header }
				: { ...c, state: 'error', error: h.error };
		})
	);

	$effect(() => {
		if (!isOpen) return;
		const pending = (e.attachments ?? []).filter((c) => !requested.has(c.id));
		if (pending.length === 0) return;
		const accountId = auth.accountId;
		for (const chip of pending) {
			requested.add(chip.id);
			void (async () => {
				try {
					if (!accountId) throw new Error('locked');
					const header = await decryptAttachmentHeader(accountId, chip.pointer);
					hydrated = { ...hydrated, [chip.id]: { state: 'ready', header } };
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'decrypt failed';
					hydrated = { ...hydrated, [chip.id]: { state: 'error', error: msg } };
				}
			})();
		}
	});

	function chipTitle(chip: AttachmentChip): string {
		if (chip.header) return chip.header.filename;
		if (chip.state === 'error') return 'Failed to decrypt';
		return 'Decrypting…';
	}

	function chipSize(chip: AttachmentChip): string {
		const n = chip.header?.plaintextSize ?? chip.pointer.sizeBytes;
		if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
		if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
		return n + ' B';
	}

	async function onDownload(chip: AttachmentChip) {
		try {
			const accountId = auth.accountId;
			if (!accountId) throw new Error('locked');
			await downloadAttachment(accountId, chip.pointer, chip.header);
		} catch (err) {
			console.warn('attachment download failed', err);
		}
	}
</script>

{#if !isOpen}
	<div
		class="tmsg collapsed"
		role="button"
		tabindex="0"
		onclick={onToggle}
		onkeydown={(ev) => {
			if (ev.key === 'Enter' || ev.key === ' ') {
				ev.preventDefault();
				onToggle();
			}
		}}
	>
		<div class="tmsg-collapsed">
			<Avatar initials={e.init} bg={e.bg} fg={e.fg} size={30} src={bimi.logoUrl(e.bimiDomain)} imgBg="#fff" />
			<span class="tc-name">{name}</span>
			<span class="tc-snip">{e.body[0] ?? ''}</span>
			<span class="tc-meta">
				{#if chips.length > 0}
					<Paperclip size={13} />
				{/if}
				<span class="tc-time">{shortWhen}</span>
			</span>
		</div>
	</div>
{:else}
	<div class="tmsg open">
		<div
			class="tmsg-head"
			role="button"
			tabindex="0"
			onclick={onToggle}
			onkeydown={(ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault();
					onToggle();
				}
			}}
		>
			<Avatar initials={e.init} bg={e.bg} fg={e.fg} size={42} src={bimi.logoUrl(e.bimiDomain)} imgBg="#fff" />
			<div class="who">
				<div class="nm">
					{name}
					{#if e.security === 'verified'}
						<span class="vbadge" title="Verified sender">
							<ShieldCheck size={13} />
						</span>
					{:else if e.security === 'first_contact'}
						<span class="vbadge fc" title="First message from this sender">
							<Shield size={13} />
						</span>
					{:else if e.security === 'mismatch'}
						<span class="vbadge fail" title="Sender identity could not be verified">
							<ShieldAlert size={13} />
						</span>
					{:else if e.auth === 'pass'}
						<span class="vbadge" title={authBadgeTitle(e.auth, e.authDetail)}>
							<ShieldCheck size={13} />
						</span>
					{:else if e.auth === 'fail'}
						<span class="vbadge fail" title={authBadgeTitle(e.auth, e.authDetail)}>
							<ShieldAlert size={13} />
						</span>
					{/if}
				</div>
				<div class="det">
					<span class="em">{e.fromAddr}</span>
					<span class="to">→ {toLine || '—'}</span>
					{#if ccLine}
						<span class="to">Cc: {ccLine}</span>
					{/if}
				</div>
			</div>
			<div class="when">{when}</div>
		</div>
		<div class="tmsg-body">
			<div class="email-sheet flush">
				{#if e.srcDoc}
					<EmailBody srcDoc={e.srcDoc} />
				{/if}
			</div>

			{#if e.forwarded}
				<div class="fwd-chip"><CornerDownLeft size={13} />Forwarded message</div>
			{/if}

			{#if e.quotedSrcDoc}
				<div class="quoted-wrap">
					<button
						type="button"
						class="quoted-toggle"
						class:on={showQuoted}
						title={showQuoted ? 'Hide trimmed content' : 'Show trimmed content'}
						aria-expanded={showQuoted}
						onclick={() => (showQuoted = !showQuoted)}
					>
						<Ellipsis size={16} />
					</button>
					{#if showQuoted}
						<div class="quoted-email">
							<EmailBody srcDoc={e.quotedSrcDoc} />
						</div>
					{/if}
				</div>
			{/if}

			{#if chips.length > 0}
				<div class="att-row">
					<div class="att-h">
						<Paperclip size={14} />{chips.length} attachment{chips.length > 1 ? 's' : ''}
					</div>
					<div class="att-list">
						{#each chips as a (a.id)}
							<div class="att-card" class:err={a.state === 'error'}>
								<div class="ic"><FileText size={19} /></div>
								<div class="info">
									<div class="nm">{chipTitle(a)}</div>
									<div class="sz">{chipSize(a)}</div>
								</div>
								<button
									type="button"
									class="dl"
									title={a.state === 'ready' ? 'Download' : 'Decrypting…'}
									disabled={a.state !== 'ready'}
									onclick={() => onDownload(a)}
								>
									<Download size={16} />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
