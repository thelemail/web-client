<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
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
	import Avatar from '$core/components/Avatar.svelte';
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
	import { acceptExternalKey } from '$core/api/externalKeys';
	import { getMessage } from '$core/api/messages';
	import type { MessageDetail } from '$core/api/types';
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
	import { pendingSendGuards, type SendGuard } from './sendGuards';
	import SendGuardDialog from './SendGuardDialog.svelte';
	import { initialsFor } from './initials';
	import { chooseFrom, sendIdentityOf } from './identities';
	import { auth } from '$core/stores/auth.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { contacts } from '$core/stores/contacts.svelte';
	import { signatures } from '$core/stores/signatures.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import {
		applySignatureSeed,
		swapSignatureForAddress,
		insertSignature,
		removeSignature,
		hasRenderableHtml
	} from './signatureRegion';
	import type { Editor } from '@tiptap/core';
	import { holdRestart } from '$core/stores/restartGuard';
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
	const identityOptions = $derived<SendIdentity[]>(
		addresses.items.length === 0
			? [userIdentity]
			: addresses.sendable.map((a) => sendIdentityOf(a, auth.fullName))
	);
	let fromEmail = $state<string | null>(null);
	const from = $derived(chooseFrom(identityOptions, fromEmail));
	const ident = $derived<SendIdentity>(from.identity ?? userIdentity);
	const noSender = $derived(from.identity === null);
	const fromNotice = $derived(
		from.unavailable && addresses.getByEmail(from.unavailable)?.suspended ? from.unavailable : null
	);
	let identInit = $state(false);
	let fromOpen = $state(false);
	let fromRef: HTMLElement | undefined = $state();

	function addressedIdentityEmail(): string | null {
		const candidates: (string | undefined)[] = [
			seed?.deliveredTo,
			m.deliveredTo,
			...(m.thread ?? []).map((t) => t.deliveredTo),
			...seedRecipients.map((r) => r.address),
			...(m.recipients ?? []).map((r) => r.address),
			...(m.thread ?? []).flatMap((t) => (t.recipients ?? []).map((r) => r.address))
		];
		for (const address of candidates) {
			if (!address) continue;
			const own = addresses.getByRecipient(address);
			if (own) return own.email;
		}
		return auth.email;
	}

	$effect(() => {
		if (identInit || addresses.items.length === 0) return;
		fromEmail = addressedIdentityEmail();
		identInit = true;
	});

	let signatureSeeded = $state(false);
	let signatureOn = $state(false);
	let signatureChosen = $state(false);

	const replyAddress = $derived(addresses.getByEmail(ident.email));
	const signatureBody = $derived(signatures.bodyFor(replyAddress?.id ?? null));

	$effect(() => {
		if (!editor || !identInit || signatureSeeded) return;
		if (!signatures.loaded) return;
		const addr = addresses.getByEmail(ident.email);
		if (addr) {
			const body = signatures.effectiveFor(addr.id, 'reply');
			if (body) {
				applySignatureSeed(editor, body);
				signatureOn = true;
			}
		}
		signatureSeeded = true;
	});

	function toggleSignature(next: boolean) {
		if (!editor) return;
		signatureChosen = true;
		signatureOn = next;
		if (next) insertSignature(editor, signatureBody);
		else removeSignature(editor);
	}

	function pickIdentity(email: string) {
		fromOpen = false;
		if (email === ident.email) return;
		fromEmail = email;
		const addr = addresses.getByEmail(email);
		if (editor && signatureSeeded && addr) {
			const body = signatures.bodyFor(addr.id);
			const keep = signatureChosen
				? signatureOn
				: signatures.effectiveFor(addr.id, 'reply') !== null;
			signatureOn = keep && !!body.trim();
			swapSignatureForAddress(editor, signatureOn ? body : '');
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
		if (n >= 1024 * 1024) return msg.mail_size_mb({ size: (n / (1024 * 1024)).toFixed(1) });
		if (n >= 1024) return msg.mail_size_kb({ size: (n / 1024).toFixed(1) });
		return msg.mail_size_bytes({ size: n });
	}

	function totalBytes(): number {
		return attachments.reduce((acc, a) => acc + a.file.size, 0);
	}

	function addFiles(files: FileList | File[]) {
		attErr = null;
		for (const file of Array.from(files)) {
			if (attachments.length >= MAX_ATTACHMENTS) {
				attErr = msg.mail_compose_att_max_count({ count: MAX_ATTACHMENTS });
				return;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				attErr = msg.mail_compose_att_too_large({ name: file.name, size: formatSize(MAX_ATTACHMENT_BYTES) });
				continue;
			}
			if (totalBytes() + file.size > MAX_TOTAL_BYTES) {
				attErr = msg.mail_compose_att_total_too_large({ size: formatSize(MAX_TOTAL_BYTES) });
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
		if (failed) attErr = msg.mail_compose_att_reattach_failed();
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
		validCount > 0 && !hasInvalid && bodyOk && status !== 'sending' && attReady && !noSender
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
		allRecipients.find((c) => c.valid) ?? { name: '', email: msg.mail_compose_this_recipient() }
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

	function identityKindLabel(kind: SendIdentity['kind']): string {
		if (kind === 'Alias') return msg.mail_compose_ident_alias();
		if (kind === 'Identity') return msg.mail_compose_ident_identity();
		return msg.mail_compose_ident_default();
	}

	const modeLabel = $derived(
		mode === 'all'
			? msg.mail_reader_reply_all()
			: mode === 'forward'
				? msg.mail_reader_forward()
				: msg.mail_reader_reply()
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
						msg.mail_compose_link_failed()
					);
				}
			}
			const headers = replyThreadHeaders(ids);
			if (attachments.length > 0) {
				await orchestrator.ensureRecipientCopies(attachments, recipientAddresses());
			}
			const bodyStr = text.trim();
			const htmlHasContent = !!bodyStr || hasRenderableHtml(html);
			const q = quoteRemoved ? null : quote;
			const chip = (c: RecipientChip) => ({ display: c.name, address: c.email });
			await dispatchSend(
				{
					to: validTo.map(chip),
					cc: validCc.length ? validCc.map(chip) : undefined,
					bcc: validBcc.length ? validBcc.map(chip) : undefined,
					subject: subject.trim(),
					body: q ? (bodyStr ? `${bodyStr}\n\n${q.text}` : q.text) : bodyStr,
					bodyHtml: (q ? `${htmlHasContent ? html : ''}${q.html}` : html) || undefined,
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
				err = new SendError('unknown', e instanceof Error ? e.message : msg.mail_compose_send_failed());
				attempts = 0;
			}
		}
	}

	let pendingAfter: SendAfter = 'none';
	let guards = $state<SendGuard[]>([]);
	let guardedRun: (() => void) | null = null;

	function guardedSend(run: () => void): void {
		if (!canSend) {
			run();
			return;
		}
		const next = pendingSendGuards({
			settings: accountSettings.composing,
			statuses: allRecipients.filter((c) => c.valid).map((c) => encStatusFor(c.email)),
			subject: mode === 'forward' ? subject : undefined
		});
		if (next.length === 0) {
			run();
			return;
		}
		sendOpen = false;
		guards = next;
		guardedRun = run;
	}

	function confirmGuards(): void {
		const run = guardedRun;
		guards = [];
		guardedRun = null;
		run?.();
	}

	function cancelGuards(): void {
		guards = [];
		guardedRun = null;
	}

	const runSend = () => guardedSend(() => performSend(false, 'none'));
	const sendAndArchive = () => guardedSend(() => performSend(false, 'archive'));
	const retrySend = () => performSend(false, pendingAfter);
	const trustAndSend = () => performSend(true, pendingAfter);
	async function acceptExternalAndSend() {
		const payload = err?.payload;
		if (payload?.kind === 'external-key-change') {
			try {
				await acceptExternalKey(payload.address, payload.currentFingerprint);
			} catch {
				err = new SendError('unknown', msg.mail_compose_accept_key_failed());
				return;
			}
		}
		await performSend(false, pendingAfter);
	}

	onMount(() => {
		void contacts.ensureLoaded();
		const t = setTimeout(() => boxRef?.scrollIntoView({ block: 'start' }), 0);
		const release = holdRestart(() => {
			if (status === 'sending') return msg.mail_compose_hold_sending();
			if (text.trim() || attachments.length > 0) return msg.mail_compose_hold_reply_unsaved();
			return null;
		});
		return () => {
			clearTimeout(t);
			release();
		};
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
					<Avatar
						initials={ident.init}
						src={ident.kind === 'Alias' ? null : auth.avatarUrl}
						fit="cover"
						size={20}
						bg={ident.bg}
						fg={ident.fg}
					/>
					<span class="ft-email">{ident.email}</span>
					<ChevronDown size={14} />
				</button>
				{#if fromOpen}
					<div class="from-menu" role="menu">
						<div class="fm-h">{msg.mail_compose_send_as()}</div>
						{#each identityOptions as id, i (id.email + '-' + i)}
							<button
								type="button"
								class="fm-item"
								class:on={id.email === ident.email}
								role="menuitemradio"
								aria-checked={id.email === ident.email}
								onclick={() => pickIdentity(id.email)}
							>
								<Avatar
									initials={id.init}
									src={id.kind === 'Alias' ? null : auth.avatarUrl}
									fit="cover"
									size={30}
									bg={id.bg}
									fg={id.fg}
								/>
								<span class="fm-tx">
									<span class="fm-top">
										<b>{id.name}</b>
										<span class="fm-kind">{identityKindLabel(id.kind)}</span>
									</span>
									<span class="fm-em">{id.email}</span>
								</span>
								{#if id.email === ident.email}<Check size={17} />{/if}
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
				title={msg.mail_compose_discard()}
				disabled={status === 'sending'}
				onclick={onClose}
			>
				<X size={15} />
			</button>
		{/if}
	</div>
	{#if noSender}
		<div class="cnote"><CircleAlert size={14} />{msg.mail_compose_no_sender()}</div>
	{:else if fromNotice}
		<div class="cnote">
			<CircleAlert size={14} />{msg.mail_compose_from_unavailable({
				address: fromNotice,
				from: ident.email
			})}
		</div>
	{/if}

	{#snippet ccBccSlot()}
		<div class="ccbcc">
			{#if !showCc}
				<button
					type="button"
					onclick={() => {
						showCc = true;
						ccFocus = true;
					}}>{msg.mail_recip_cc()}</button
				>
			{/if}
			{#if !showBcc}
				<button
					type="button"
					onclick={() => {
						showBcc = true;
						bccFocus = true;
					}}>{msg.mail_recip_bcc()}</button
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
		<span class="recip-label">{msg.mail_compose_subject()}</span>
		{#if mode === 'forward'}
			<input bind:value={subject} placeholder={msg.mail_compose_subject()} />
		{:else}
			<span class="subj-static" title={subject}>{subject}</span>
		{/if}
	</div>

	<RichEditor
		bind:html
		bind:text
		bind:editor
		placeholder={mode === 'forward' ? msg.mail_compose_add_note() : msg.mail_compose_write_reply()}
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
				title={showQuote ? msg.mail_compose_hide_quoted() : msg.mail_compose_show_quoted()}
				aria-expanded={showQuote}
				onclick={() => (showQuote = !showQuote)}
			>
				<Ellipsis size={16} />
			</button>
			<span class="rq-lbl">{mode === 'forward' ? msg.mail_forwarded_chip() : msg.mail_compose_quoted_text()}</span>
			<button
				type="button"
				class="rq-rm"
				title={msg.mail_compose_remove_quoted()}
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

	<EditorToolbar
		{editor}
		signature={{
			present: !!signatureBody.trim(),
			on: signatureOn,
			onToggle: toggleSignature
		}}
	/>

	{#if warn && !canSend && !noSender && status !== 'sending'}
		<div class="cwarn">
			<CircleAlert size={14} />
			{hasInvalid
				? msg.mail_compose_invalid_addresses()
				: validCount === 0
					? msg.mail_compose_need_recipient()
					: msg.mail_compose_need_body()}
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
							<div class="errmsg">{a.error ?? msg.mail_attach_upload_failed()}</div>
						{/if}
					</div>
					<div class="state">
						{#if a.status === 'encrypting' || a.status === 'uploading' || a.status === 'queued'}
							<Loader2 size={14} class="spin" />
						{/if}
						<button type="button" class="rm" title={msg.common_remove()} onclick={() => removeAttachment(a.id)}>
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
					<span class="send-spin"></span>{msg.mail_compose_sending()}
				{:else}
					<Send size={15} />{msg.mail_compose_send()}
				{/if}
			</button>
			{#if canArchive}
				<button
					type="button"
					class="rf-caret"
					class:on={sendOpen}
					title={msg.mail_compose_send_options()}
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
							<Send size={17} />{msg.mail_compose_send()}
						</button>
						<button type="button" class="mitem" role="menuitem" onclick={sendAndArchive}>
							<Archive size={17} />{msg.mail_compose_send_archive()}
						</button>
					</div>
				{/if}
			{/if}
		</div>
		<button type="button" class="rb-ico" title={msg.mail_compose_attach()} onclick={pickFiles}>
			<Paperclip size={17} />
		</button>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			class="att-hidden-input"
			onchange={onFileInputChange}
		/>
		<button type="button" class="rb-ico" title={msg.mail_compose_discard()} onclick={discard}>
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

{#if guards.length > 0}
	<SendGuardDialog {guards} onConfirm={confirmGuards} onCancel={cancelGuards} />
{/if}

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
