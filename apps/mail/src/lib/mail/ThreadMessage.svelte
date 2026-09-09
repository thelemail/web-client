<script lang="ts">
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import Avatar from '$lib/components/Avatar.svelte';
	import EmailBody from './EmailBody.svelte';
	import TrustMark from './TrustMark.svelte';
	import { formatWhenLong, type ThreadEntry } from './data';
	import AttachmentList from './AttachmentList.svelte';
	import { getMessage } from '$lib/api/messages';
	import { senderImage } from './senderImage';

	interface Props {
		e: ThreadEntry;
		isOpen: boolean;
		onToggle: () => void;
		onConfirmKeyChange?: (address: string) => void | Promise<void>;
	}

	let { e, isOpen, onToggle, onConfirmKeyChange }: Props = $props();

	const img = $derived(senderImage(e.fromAddr, e.bimiDomain));

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

	const chips = $derived(e.attachments ?? []);

	async function refreshPointer(attachmentId: string) {
		if (!e.id) return null;
		const detail = await getMessage(e.id);
		return detail.attachments?.find((a) => a.id === attachmentId)?.pointer ?? null;
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
			<Avatar initials={e.init} bg={e.bg} fg={e.fg} size={30} src={img.src} fit={img.fit} imgBg={img.imgBg} />
			<span class="tc-name">
				<span class="tc-nm">{name}</span>
				{#if e.trust}
					<TrustMark trust={e.trust} variant="static" />
				{/if}
			</span>
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
			<Avatar initials={e.init} bg={e.bg} fg={e.fg} size={42} src={img.src} fit={img.fit} imgBg={img.imgBg} />
			<div class="who">
				<div class="nm">
					<span class="nm-t">{name}</span>
				</div>
				<div class="det">
					<span class="em">{e.fromAddr}</span>
					<span class="to">→ {toLine || '—'}</span>
					{#if ccLine}
						<span class="to">Cc: {ccLine}</span>
					{/if}
				</div>
			</div>
			<div class="prov">
				<div class="when">{when}</div>
				{#if e.trust}
					<TrustMark
						trust={e.trust}
						variant="chip"
						onConfirmKeyChange={onConfirmKeyChange && e.fromAddr
							? () => onConfirmKeyChange(e.fromAddr)
							: undefined}
					/>
				{/if}
			</div>
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

			<AttachmentList {chips} refresh={refreshPointer} />
		</div>
	</div>
{/if}
