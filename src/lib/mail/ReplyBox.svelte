<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Reply from '@lucide/svelte/icons/reply';
	import ReplyAll from '@lucide/svelte/icons/reply-all';
	import Forward from '@lucide/svelte/icons/forward';
	import Send from '@lucide/svelte/icons/send';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Archive from '@lucide/svelte/icons/archive';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import FileText from '@lucide/svelte/icons/file-text';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Avatar from './Avatar.svelte';
	import EmailBody from './EmailBody.svelte';
	import RecipientField from './RecipientField.svelte';
	import SendingVeil from './SendingVeil.svelte';
	import InlineSendError, { type InlineErrorCode } from './InlineSendError.svelte';
	import DirectoryFailModal from './DirectoryFailModal.svelte';
	import TofuModal from './TofuModal.svelte';
	import RichEditor from './editor/RichEditor.svelte';
	import EditorToolbar from './editor/EditorToolbar.svelte';
	import { SendError } from './send';
	import { dispatchSend } from './sendDispatch';
	import { acceptExternalKey } from '$lib/api/externalKeys';
	import { getMessage } from '$lib/api/messages';
	import type { MessageDetail } from '$lib/api/types';
	import {
		recipientChip,
		type Message,
		type RecipientChip,
		type SendIdentity,
		type ThreadEntry
	} from './data';
	import type { MessagePreviewRecipient } from './preview';
	import { forwardSubject, replySubject } from './subjects';
	import { replyTargets, type ReplyParty } from './replyRecipients';
	import {
		forwardQuoteHtml,
		forwardQuoteText,
		replyQuoteHtml,
		replyQuoteText,
		type QuoteSource
	} from './quote';
	import { loadMessageBody } from './bodySource';
	import { buildSrcDoc } from './render';
	import { restoreAttachmentFile } from './draft';
	import { replyThreadHeaders, type ReplyThreadIds } from './threading';
	import { EncStatusTracker } from './encStatus.svelte';
	import { summarizeEncryption } from './encSummary';
	import { initialsFor } from './initials';
	import { auth } from '$lib/stores/auth.svelte';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { contacts } from '$lib/stores/contacts.svelte';
	import { signatures } from '$lib/stores/signatures.svelte';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import { applySignatureSeed, swapSignatureForAddress } from './signatureRegion';
	import type { Editor } from '@tiptap/core';
	import {
		MAX_ATTACHMENT_BYTES,
		MAX_ATTACHMENTS,
		MAX_TOTAL_BYTES,
		UploadOrchestrator,
		type Attachment as ComposeAttachment
	} from './attachmentUpload';

	export type ReplyMode = 'reply' | 'all' | 'forward';

	type SendAfter = 'none' | 'archive';

	interface Props {
		m: Message;
		mode?: ReplyMode;
		seed?: ThreadEntry | null;
		canArchive?: boolean;
		onSent?: () => void;
		onSentAndArchive?: () => void;
		onClose?: () => void;
	}

	let {
		m,
		mode = 'reply',
		seed = null,
		canArchive = false,
		onSent,
		onSentAndArchive,
		onClose
	}: Props = $props();

	const seedId = untrack(() => seed?.id ?? m.id);
	const seedRecipients: MessagePreviewRecipient[] = untrack(
		() => seed?.recipients ?? m.recipients ?? []
	);
	const seedSender: ReplyParty = untrack(() =>
		seed
			? { display: seed.me ? (auth.fullName ?? '') : seed.from, address: seed.fromAddr }
			: { display: m.from, address: m.fromAddr }
	);
	const seedSenderIsMe = untrack(() => (seed ? !!seed.me : m.direction === 'sent'));
	const seedEpoch = untrack(() => seed?.epoch ?? m.epoch);

	function myEmails(): Set<string> {
		const mine = new Set<string>();
		for (const a of addresses.items) mine.add(a.email.toLowerCase());
		if (auth.email) mine.add(auth.email.toLowerCase());
		return mine;
	}

	const seededChips = untrack(() => {
		if (mode === 'forward') return { to: [] as RecipientChip[], cc: [] as RecipientChip[] };
		const targets = replyTargets(
			{ sender: seedSender, senderIsMe: seedSenderIsMe, recipients: seedRecipients },
			mode === 'all' ? 'all' : 'reply',
			myEmails()
		);
		const chip = (p: ReplyParty) =>
			recipientChip({ name: p.display || undefined, address: p.address });
		return { to: targets.to.map(chip), cc: targets.cc.map(chip) };
	});

	let to = $state<RecipientChip[]>(seededChips.to);
	let cc = $state<RecipientChip[]>(seededChips.cc);
	let bcc = $state<RecipientChip[]>([]);
	let showCc = $state(seededChips.cc.length > 0);
	let showBcc = $state(false);
	let ccFocus = $state(false);
	let bccFocus = $state(false);
	let subject = $state(
		untrack(() => (mode === 'forward' ? forwardSubject(m.subj) : replySubject(m.subj)))
	);

	let text = $state('');
	let html = $state('');
	let status = $state<'idle' | 'sending'>('idle');
	let err = $state<SendError | null>(null);
	let attempts = $state(0);
	let warn = $state(false);
	let editor: Editor | null = $state(null);
	let boxRef: HTMLDivElement | undefined = $state();
	let sendOpen = $state(false);
	let sendRef: HTMLDivElement | undefined = $state();

	const userIdentity = $derived<SendIdentity>({
		name: auth.fullName ?? auth.email ?? 'Me',
		email: auth.email ?? '',
		init: initialsFor(auth.fullName, auth.email),
		bg: 'var(--pine-700)',
		fg: '#EEF2EA',
		org: '',
		kind: 'Default'
	});
	const identityOptions = $derived.by<SendIdentity[]>(() => {
		const fromStore: SendIdentity[] = addresses.items.map((a) => {
			const label = a.shared ? (a.name ?? a.email) : (a.name ?? auth.fullName ?? a.email);
			return {
				name: label,
				email: a.email,
				init: initialsFor(label, a.email),
				bg: a.shared ? 'var(--info-700)' : 'var(--pine-700)',
				fg: '#EEF2EA',
				org: '',
				kind: a.shared ? 'Alias' : a.isPrimary ? 'Default' : 'Identity',
				addressId: a.id,
				aliasId: a.sharedAliasId ?? undefined
			};
		});
		if (fromStore.length === 0) return [userIdentity];
		return fromStore;
	});
	let identIdx = $state(0);
	const ident = $derived<SendIdentity>(identityOptions[identIdx] ?? userIdentity);
	let identInit = $state(false);
	let fromOpen = $state(false);
	let fromRef: HTMLElement | undefined = $state();

	$effect(() => {
		if (identIdx >= identityOptions.length) identIdx = 0;
	});

	function addressedIdentityEmail(): string | null {
		const lists: (MessagePreviewRecipient[] | undefined)[] = [
			seedRecipients,
			m.recipients,
			...(m.thread ?? []).map((t) => t.recipients)
		];
		for (const list of lists) {
			for (const r of list ?? []) {
				if (addresses.getByEmail(r.address)) return r.address;
			}
		}
		return auth.email;
	}

	$effect(() => {
		if (identInit) return;
		if (addresses.items.length === 0) return;
		const target = addressedIdentityEmail();
		if (target) {
			const idx = identityOptions.findIndex((o) => o.email.toLowerCase() === target.toLowerCase());
			if (idx >= 0) identIdx = idx;
		}
		identInit = true;
	});

	let signatureSeeded = $state(false);
	$effect(() => {
		if (!editor || !identInit || signatureSeeded) return;
		const addr = addresses.getByEmail(ident.email);
		if (addr) {
			const sig = signatures.getForAddress(addr.id);
			if (sig?.appendOnReply && sig.bodyHtml) applySignatureSeed(editor, addr.id, sig.bodyHtml);
		}
		signatureSeeded = true;
	});

	function pickIdentity(i: number) {
		fromOpen = false;
		if (i === identIdx) return;
		identIdx = i;
		const next = identityOptions[i];
		const addr = next ? addresses.getByEmail(next.email) : null;
		if (editor && signatureSeeded && addr) {
			const sig = signatures.getForAddress(addr.id);
			swapSignatureForAddress(
				editor,
				addr.id,
				sig?.appendOnReply && sig.bodyHtml ? sig.bodyHtml : ''
			);
		}
	}

	let attachments = $state<ComposeAttachment[]>([]);
	let fileInput: HTMLInputElement | undefined = $state();
	let attErr = $state<string | null>(null);
	const orchestrator = new UploadOrchestrator((a) => {
		attachments = attachments.map((x) => (x.id === a.id ? { ...a } : x));
	}, auth.accountId ?? '');

	function recipientAddresses(): string[] {
		return [...to, ...cc, ...bcc].filter((c) => c.valid).map((c) => c.email);
	}

	function formatSize(n: number): string {
		if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
		if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
		return n + ' B';
	}

	function totalBytes(): number {
		return attachments.reduce((acc, a) => acc + a.file.size, 0);
	}

	function addFiles(files: FileList | File[]) {
		attErr = null;
		for (const file of Array.from(files)) {
			if (attachments.length >= MAX_ATTACHMENTS) {
				attErr = `Maximum ${MAX_ATTACHMENTS} attachments per message.`;
				return;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				attErr = `${file.name} is larger than ${formatSize(MAX_ATTACHMENT_BYTES)}.`;
				continue;
			}
			if (totalBytes() + file.size > MAX_TOTAL_BYTES) {
				attErr = `Total attachment size would exceed ${formatSize(MAX_TOTAL_BYTES)}.`;
				continue;
			}
			const att: ComposeAttachment = {
				id: crypto.randomUUID(),
				file,
				status: 'queued',
				progress: 0,
				disposition: 'attachment'
			};
			attachments = [...attachments, att];
			void orchestrator.startUpload(att, recipientAddresses(), Math.max(0, attachments.indexOf(att)));
		}
	}

	function pickFiles() {
		fileInput?.click();
	}

	function onFileInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files) addFiles(input.files);
		input.value = '';
	}

	function removeAttachment(id: string) {
		attachments = attachments.filter((a) => a.id !== id);
	}

	let quote = $state<{ html: string; text: string } | null>(null);
	let quoteRemoved = $state(false);
	let showQuote = $state(false);
	let threadIds = $state<ReplyThreadIds | null>(null);

	const quoteSrcDoc = $derived(quote ? buildSrcDoc(quote.html, false) : null);

	function partyLine(list: MessagePreviewRecipient[]): string {
		return list
			.map((r) => (r.display && r.display !== r.address ? `${r.display} <${r.address}>` : r.address))
			.join(', ');
	}

	function quoteSourceFrom(htmlSrc: string | undefined, textSrc: string | undefined): QuoteSource {
		const toKind = seedRecipients.filter((r) => r.kind === 'to');
		const ccKind = seedRecipients.filter((r) => r.kind === 'cc');
		return {
			fromDisplay: seedSender.display,
			fromAddress: seedSender.address,
			toLine: toKind.length ? partyLine(toKind) : (seed?.to ?? m.to ?? ''),
			ccLine: ccKind.length ? partyLine(ccKind) : undefined,
			epoch: seedEpoch,
			subject: m.subj,
			html: htmlSrc,
			text: textSrc
		};
	}

	function fallbackQuoteText(): string {
		const fromSeed = seed?.body?.join('\n\n') ?? '';
		if (fromSeed.trim()) return fromSeed.trim();
		const fromBody = m.body?.length ? m.body.join('\n\n') : '';
		return (fromBody || m.prev || '').trim();
	}

	function setQuote(htmlSrc: string | undefined, textSrc: string | undefined) {
		const src = quoteSourceFrom(htmlSrc, textSrc);
		quote =
			mode === 'forward'
				? { html: forwardQuoteHtml(src), text: forwardQuoteText(src) }
				: { html: replyQuoteHtml(src), text: replyQuoteText(src) };
	}

	function threadIdsFrom(detail: MessageDetail): ReplyThreadIds {
		return {
			seedId,
			externalMessageId: detail.externalMessageId ?? undefined,
			references: detail.references ?? undefined
		};
	}

	async function attachForwarded(accountId: string, detail: MessageDetail): Promise<void> {
		const files: File[] = [];
		let failed = false;
		for (const a of detail.attachments ?? []) {
			if (a.isInline) continue;
			try {
				files.push(await restoreAttachmentFile(accountId, a.pointer));
			} catch {
				failed = true;
			}
		}
		if (files.length) addFiles(files);
		if (failed) attErr = 'Could not re-attach a file from the original message.';
	}

	async function initFromDetail(): Promise<void> {
		const accountId = auth.accountId;
		if (accountId) {
			try {
				const { detail, render } = await loadMessageBody(accountId, seedId, {
					stripTracking: accountSettings.privacy.stripTrackingParams
				});
				threadIds = threadIdsFrom(detail);
				if (render.contentHtml || render.contentText) {
					setQuote(render.contentHtml, render.contentText);
				} else {
					setQuote(undefined, fallbackQuoteText());
				}
				if (mode === 'forward') await attachForwarded(accountId, detail);
				return;
			} catch {
				setQuote(undefined, fallbackQuoteText());
				return;
			}
		}
		setQuote(undefined, fallbackQuoteText());
	}

	const initPromise = untrack(() => initFromDetail());

	const encTracker = new EncStatusTracker();
	const allRecipients = $derived([...to, ...cc, ...bcc]);
	$effect(() => {
		encTracker.track(allRecipients.filter((c) => c.valid).map((c) => c.email));
	});
	function encStatusFor(email: string) {
		return encTracker.statusFor(email);
	}
	const encSummary = $derived(
		summarizeEncryption(allRecipients.filter((c) => c.valid).map((c) => encStatusFor(c.email)))
	);

	const validCount = $derived(allRecipients.filter((c) => c.valid).length);
	const hasInvalid = $derived(allRecipients.some((c) => !c.valid));
	const attReady = $derived(attachments.every((a) => a.status === 'ready'));
	const bodyOk = $derived(mode === 'forward' || text.trim().length > 0);
	const canSend = $derived(
		validCount > 0 && !hasInvalid && bodyOk && status !== 'sending' && attReady
	);

	const INLINE_CODES = new Set<SendError['code']>([
		'recipient_unknown',
		'locked',
		'no_account',
		'encrypt',
		'recipient_key_invalid',
		'rate_limited',
		'malware_blocked',
		'rejected',
		'server_error',
		'network'
	]);
	const inlineRetryAfter = $derived(
		err?.payload?.kind === 'rate_limited' ? err.payload.retryAfterSeconds : 0
	);
	const inlineErr = $derived(err && INLINE_CODES.has(err.code) ? err : null);
	const primaryRecip = $derived(
		allRecipients.find((c) => c.valid) ?? { name: '', email: 'this recipient' }
	);
	const failedAddress = $derived.by(() => {
		const p = err?.payload;
		if (!p) return null;
		if (p.kind === 'tofu' || p.kind === 'directory' || p.kind === 'external-key-change') {
			return p.address;
		}
		return null;
	});
	const modalRecip = $derived(
		failedAddress
			? (allRecipients.find((c) => c.email.toLowerCase() === failedAddress.toLowerCase()) ?? {
					name: '',
					email: failedAddress
				})
			: primaryRecip
	);

	$effect(() => {
		void to;
		void cc;
		void bcc;
		void subject;
		void text;
		warn = false;
		err = null;
	});

	const modeLabel = $derived(
		mode === 'all' ? 'Reply all' : mode === 'forward' ? 'Forward' : 'Reply'
	);

	function handleDocMouseDown(e: MouseEvent) {
		if (fromOpen && fromRef && !fromRef.contains(e.target as Node)) fromOpen = false;
		if (sendOpen && sendRef && !sendRef.contains(e.target as Node)) sendOpen = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (sendOpen) {
			sendOpen = false;
			e.stopPropagation();
			return;
		}
		if (fromOpen) {
			fromOpen = false;
			e.stopPropagation();
		}
	}

	function focusTo() {
		boxRef?.querySelector<HTMLInputElement>('.recip-input')?.focus();
	}

	const clearErr = () => {
		err = null;
		attempts = 0;
	};
	const dismiss = () => clearErr();
	const editRecipient = () => {
		clearErr();
		setTimeout(focusTo, 0);
	};
	const unlockVault = () => {
		err = null;
	};

	function discard() {
		text = '';
		html = '';
		attachments = [];
		orchestrator.cancel();
		attErr = null;
		quoteRemoved = false;
		editor?.commands.clearContent();
		clearErr();
	}

	async function performSend(acceptKeyChange: boolean, after: SendAfter = 'none') {
		if (!canSend) {
			warn = true;
			return;
		}
		sendOpen = false;
		pendingAfter = after;
		const validTo = to.filter((c) => c.valid);
		const validCc = cc.filter((c) => c.valid);
		const validBcc = bcc.filter((c) => c.valid);
		status = 'sending';
		err = null;
		try {
			await initPromise;
			let ids = threadIds;
			if (!ids) {
				try {
					ids = threadIdsFrom(await getMessage(seedId));
					threadIds = ids;
				} catch {
					throw new SendError(
						'network',
						'Could not link this message to the conversation. Check your connection and try again.'
					);
				}
			}
			const headers = replyThreadHeaders(ids);
			if (attachments.length > 0) {
				await orchestrator.ensureRecipientCopies(attachments, recipientAddresses());
			}
			const bodyStr = text.trim();
			const q = quoteRemoved ? null : quote;
			const chip = (c: RecipientChip) => ({ display: c.name, address: c.email });
			await dispatchSend(
				{
					to: validTo.map(chip),
					cc: validCc.length ? validCc.map(chip) : undefined,
					bcc: validBcc.length ? validBcc.map(chip) : undefined,
					subject: subject.trim(),
					body: q ? (bodyStr ? `${bodyStr}\n\n${q.text}` : q.text) : bodyStr,
					bodyHtml: (q ? `${bodyStr ? html : ''}${q.html}` : html) || undefined,
					inReplyToMessageId: headers.inReplyToMessageId,
					inReplyToHeader: headers.inReplyToHeader,
					references: headers.references,
					attachments: attachments.length > 0 ? attachments : undefined,
					fromEmail: ident.email,
					fromName: ident.name,
					fromAliasId: ident.aliasId
				},
				{ acceptKeyChange }
			);
			status = 'idle';
			attempts = 0;
			if (after === 'archive' && canArchive) onSentAndArchive?.();
			else onSent?.();
		} catch (e) {
			status = 'idle';
			if (e instanceof SendError) {
				err = e;
				attempts = e.code === 'encrypt' ? attempts + 1 : 0;
			} else {
				err = new SendError('unknown', e instanceof Error ? e.message : 'Send failed');
				attempts = 0;
			}
		}
	}

	let pendingAfter: SendAfter = 'none';
	const runSend = () => performSend(false, 'none');
	const sendAndArchive = () => performSend(false, 'archive');
	const retrySend = () => performSend(false, pendingAfter);
	const trustAndSend = () => performSend(true, pendingAfter);
	async function acceptExternalAndSend() {
		const payload = err?.payload;
		if (payload?.kind === 'external-key-change') {
			try {
				await acceptExternalKey(payload.address, payload.currentFingerprint);
			} catch {
				err = new SendError('unknown', 'Could not accept the new key. Please try again.');
				return;
			}
		}
		await performSend(false, pendingAfter);
	}

	onMount(() => {
		void contacts.ensureLoaded();
		const t = setTimeout(() => boxRef?.scrollIntoView({ block: 'start' }), 0);
		return () => clearTimeout(t);
	});
</script>

<svelte:document onmousedown={handleDocMouseDown} onkeydown={handleKey} />

<div class="replybox" bind:this={boxRef}>
	<div class="rt">
		{#if mode === 'all'}
			<ReplyAll size={14} />
		{:else if mode === 'forward'}
			<Forward size={14} />
		{:else}
			<Reply size={14} />
		{/if}
		{modeLabel}
		{#if identityOptions.length > 1}
			<span class="rt-from" bind:this={fromRef}>
				<button
					type="button"
					class="from-trigger"
					class:open={fromOpen}
					onclick={() => (fromOpen = !fromOpen)}
				>
					<Avatar initials={ident.init} size={20} bg={ident.bg} fg={ident.fg} />
					<span class="ft-email">{ident.email}</span>
					<ChevronDown size={14} />
				</button>
				{#if fromOpen}
					<div class="from-menu" role="menu">
						<div class="fm-h">Send mail as</div>
						{#each identityOptions as id, i (id.email + '-' + i)}
							<button
								type="button"
								class="fm-item"
								class:on={i === identIdx}
								role="menuitemradio"
								aria-checked={i === identIdx}
								onclick={() => pickIdentity(i)}
							>
								<Avatar initials={id.init} size={30} bg={id.bg} fg={id.fg} />
								<span class="fm-tx">
									<span class="fm-top">
										<b>{id.name}</b>
										<span class="fm-kind">{id.kind}</span>
									</span>
									<span class="fm-em">{id.email}</span>
								</span>
								{#if i === identIdx}<Check size={17} />{/if}
							</button>
						{/each}
					</div>
				{/if}
			</span>
		{/if}
		{#if onClose}
			<button
				type="button"
				class="rt-x"
				title="Discard"
				disabled={status === 'sending'}
				onclick={onClose}
			>
				<X size={15} />
			</button>
		{/if}
	</div>

	{#snippet ccBccSlot()}
		<div class="ccbcc">
			{#if !showCc}
				<button
					type="button"
					onclick={() => {
						showCc = true;
						ccFocus = true;
					}}>Cc</button
				>
			{/if}
			{#if !showBcc}
				<button
					type="button"
					onclick={() => {
						showBcc = true;
						bccFocus = true;
					}}>Bcc</button
				>
			{/if}
		</div>
	{/snippet}

	<RecipientField
		label="To"
		chips={to}
		setChips={(next) => (to = next)}
		contacts={contacts.items}
		autoFocus={mode === 'forward'}
		rightSlot={ccBccSlot}
		{encStatusFor}
	/>

	{#if showCc}
		<RecipientField
			label="Cc"
			chips={cc}
			setChips={(next) => (cc = next)}
			contacts={contacts.items}
			autoFocus={ccFocus}
			{encStatusFor}
			onRemoveField={() => {
				cc = [];
				showCc = false;
				ccFocus = false;
			}}
		/>
	{/if}

	{#if showBcc}
		<RecipientField
			label="Bcc"
			chips={bcc}
			setChips={(next) => (bcc = next)}
			contacts={contacts.items}
			autoFocus={bccFocus}
			{encStatusFor}
			onRemoveField={() => {
				bcc = [];
				showBcc = false;
				bccFocus = false;
			}}
		/>
	{/if}

	<div class="cfield subj">
		<span class="recip-label">Subject</span>
		{#if mode === 'forward'}
			<input bind:value={subject} placeholder="Subject" />
		{:else}
			<span class="subj-static" title={subject}>{subject}</span>
		{/if}
	</div>

	<RichEditor
		bind:html
		bind:text
		bind:editor
		placeholder={mode === 'forward' ? 'Add a note…' : 'Write your reply…'}
		disabled={status === 'sending'}
		autofocus={mode !== 'forward'}
		class="cbody reply"
	/>

	{#if quote && !quoteRemoved}
		<div class="rq">
			<button
				type="button"
				class="quoted-toggle"
				class:on={showQuote}
				title={showQuote ? 'Hide quoted text' : 'Show quoted text'}
				aria-expanded={showQuote}
				onclick={() => (showQuote = !showQuote)}
			>
				<Ellipsis size={16} />
			</button>
			<span class="rq-lbl">{mode === 'forward' ? 'Forwarded message' : 'Quoted text'}</span>
			<button
				type="button"
				class="rq-rm"
				title="Remove quoted text"
				onclick={() => {
					quoteRemoved = true;
					showQuote = false;
				}}
			>
				<X size={13} />
			</button>
		</div>
		{#if showQuote && quoteSrcDoc}
			<div class="rq-view">
				<EmailBody srcDoc={quoteSrcDoc} />
			</div>
		{/if}
	{/if}

	<EditorToolbar {editor} />

	{#if warn && !canSend && status !== 'sending'}
		<div class="cwarn">
			<CircleAlert size={14} />
			{hasInvalid
				? 'One or more addresses are not valid.'
				: validCount === 0
					? 'Add at least one recipient.'
					: 'Write a message first.'}
		</div>
	{/if}

	{#if inlineErr}
		<InlineSendError
			code={inlineErr.code as InlineErrorCode}
			{attempts}
			recipient={primaryRecip}
			retryAfterSeconds={inlineRetryAfter}
			message={inlineErr.message}
			onEditRecipient={editRecipient}
			onUnlock={unlockVault}
			onRetry={retrySend}
			onDismiss={dismiss}
		/>
	{:else if err && err.code === 'unknown'}
		<div class="cwarn">
			<CircleAlert size={14} />
			{err.message}
		</div>
	{/if}

	{#if attachments.length > 0}
		<div class="att-list">
			{#each attachments as a (a.id)}
				<div class="att-chip" class:err={a.status === 'error'}>
					<div class="ic"><FileText size={16} /></div>
					<div class="info">
						<div class="nm" title={a.file.name}>{a.file.name}</div>
						<div class="sz">{formatSize(a.file.size)}</div>
						{#if a.status === 'encrypting' || a.status === 'uploading'}
							<div class="bar"><div class="bar-fill" style="width:{Math.round(a.progress * 100)}%"></div></div>
						{:else if a.status === 'error'}
							<div class="errmsg">{a.error ?? 'Upload failed'}</div>
						{/if}
					</div>
					<div class="state">
						{#if a.status === 'encrypting' || a.status === 'uploading' || a.status === 'queued'}
							<Loader2 size={14} class="spin" />
						{/if}
						<button type="button" class="rm" title="Remove" onclick={() => removeAttachment(a.id)}>
							<X size={14} />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if attErr}
		<div class="cwarn"><CircleAlert size={14} />{attErr}</div>
	{/if}

	<div class="rf">
		<div class="rf-send" class:split={canArchive} bind:this={sendRef}>
			<button
				type="button"
				class="rb-btn primary"
				class:off={!canSend}
				onclick={runSend}
				disabled={status === 'sending' || !canSend}
			>
				{#if status === 'sending'}
					<span class="send-spin"></span>Sending…
				{:else}
					<Send size={15} />Send
				{/if}
			</button>
			{#if canArchive}
				<button
					type="button"
					class="rf-caret"
					class:on={sendOpen}
					title="Send options"
					aria-haspopup="menu"
					aria-expanded={sendOpen}
					disabled={status === 'sending' || !canSend}
					onclick={() => (sendOpen = !sendOpen)}
				>
					<ChevronUp size={15} />
				</button>
				{#if sendOpen}
					<div class="menu rf-menu" role="menu">
						<button type="button" class="mitem" role="menuitem" onclick={runSend}>
							<Send size={17} />Send
						</button>
						<button type="button" class="mitem" role="menuitem" onclick={sendAndArchive}>
							<Archive size={17} />Send &amp; archive
						</button>
					</div>
				{/if}
			{/if}
		</div>
		<button type="button" class="rb-ico" title="Attach" onclick={pickFiles}>
			<Paperclip size={17} />
		</button>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			class="att-hidden-input"
			onchange={onFileInputChange}
		/>
		<button type="button" class="rb-ico" title="Discard" onclick={discard}>
			<Trash2 size={17} />
		</button>
		<span class="enc" data-tone={encSummary.tone} title={encSummary.title}>
			{#if encSummary.tone === 'partial' || encSummary.tone === 'none'}
				<LockOpen size={14} />
			{:else}
				<Lock size={14} />
			{/if}
			{encSummary.label}
		</span>
	</div>

	{#if status === 'sending'}
		<SendingVeil />
	{/if}
</div>

{#if err && err.code === 'directory_verification_failed' && err.payload?.kind === 'directory'}
	<DirectoryFailModal
		inner={err.inner ?? 'address_mismatch'}
		recipient={modalRecip}
		requestedAddress={err.payload.requestedAddress}
		statementAddress={err.payload.statementAddress}
		signedKeyFingerprint={err.payload.signedKeyFingerprint}
		servedKeyFingerprint={err.payload.servedKeyFingerprint}
		expectedSignerFingerprint={err.payload.expectedSignerFingerprint}
		actualSignerFingerprint={err.payload.actualSignerFingerprint}
		seenVersion={err.payload.seenVersion}
		servedVersion={err.payload.servedVersion}
		onEditRecipient={editRecipient}
		onRetry={retrySend}
		onCancel={clearErr}
	/>
{:else if err && err.code === 'directory_verification_failed'}
	<DirectoryFailModal
		inner={err.inner ?? 'address_mismatch'}
		recipient={modalRecip}
		onEditRecipient={editRecipient}
		onRetry={retrySend}
		onCancel={clearErr}
	/>
{/if}

{#if err && err.code === 'tofu' && err.payload?.kind === 'tofu'}
	<TofuModal
		recipient={modalRecip}
		previousPinned={err.payload.previousPinned}
		previousVerifiedAt={err.payload.previousVerifiedAt}
		currentFingerprint={err.payload.currentFingerprint}
		onSendAnyway={trustAndSend}
		onCancel={clearErr}
	/>
{:else if err && err.code === 'tofu'}
	<TofuModal recipient={modalRecip} onSendAnyway={trustAndSend} onCancel={clearErr} />
{/if}

{#if err && err.code === 'external_key_change' && err.payload?.kind === 'external-key-change'}
	<TofuModal
		recipient={{ name: '', email: err.payload.address }}
		currentFingerprint={err.payload.currentFingerprint}
		onSendAnyway={acceptExternalAndSend}
		onCancel={clearErr}
	/>
{/if}
