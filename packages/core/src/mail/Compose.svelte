<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import X from '@lucide/svelte/icons/x';
	import Minus from '@lucide/svelte/icons/minus';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Mail from '@lucide/svelte/icons/mail';
	import Minimize2 from '@lucide/svelte/icons/minimize-2';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Send from '@lucide/svelte/icons/send';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import Avatar from '$core/components/Avatar.svelte';
	import RecipientField from './RecipientField.svelte';
	import SendingVeil from './SendingVeil.svelte';
	import InlineSendError, { type InlineErrorCode } from './InlineSendError.svelte';
	import { DraftSaver, attachmentSig } from './draftSaver.svelte';
	import {
		autosaveAllowed,
		draftSaveStatus,
		mayClose,
		type DraftLoad,
		type DraftSaveFacts
	} from './draftSave';
	import DirectoryFailModal from './DirectoryFailModal.svelte';
	import SchedulePicker from './SchedulePicker.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import TofuModal from './TofuModal.svelte';
	import RichEditor from './editor/RichEditor.svelte';
	import EditorToolbar from './editor/EditorToolbar.svelte';
	import AttachPreview from './AttachPreview.svelte';
	import FromPicker from './FromPicker.svelte';
	import { attachmentStatusText, dockAttention, sendBlock, sendBlockText } from './sendBlock';
	import EmailBody from './EmailBody.svelte';
	import { FOLDERS, formatWhenLong, recipientChip, type Message, type RecipientChip, type SendIdentity } from './data';
	import { contacts } from '$core/stores/contacts.svelte';
	import { initialsFor } from './initials';
	import { chooseFrom, fromNeedsChoice, sendIdentityOf } from './identities';
	import { auth } from '$core/stores/auth.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { signatures } from '$core/stores/signatures.svelte';
	import { SendError, type ApprovedModes } from './send';
	import { dispatchSend } from './sendDispatch';
	import { acceptExternalKey } from '$core/api/externalKeys';
	import type { RecipientEncStatus } from './RecipientField.svelte';
	import { EncStatusTracker } from './encStatus.svelte';
	import { summarizeEncryption } from './encSummary';
	import { pendingSendGuards, type SendGuard } from './sendGuards';
	import SendGuardDialog from './SendGuardDialog.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import {
		applySignatureSeed,
		swapSignatureForAddress,
		insertSignature,
		removeSignature,
		hasSignature,
		hasRenderableHtml
	} from './signatureRegion';
	import { loadMessageBody } from './bodySource';
	import { buildSrcDoc } from './render';
	import { replyThreadHeaders, type ReplyThreadIds } from './threading';
	import { forwardSubject } from './subjects';
	import {
		addressedIdentity,
		forwardFallbackText,
		forwardQuote,
		plainToHtml,
		type ForwardQuote
	} from './forward';
	import { mailbox } from '$core/stores/mailbox.svelte';
	import type { ForwardRef } from '$core/stores/compose.svelte';
	import type { MessageDetail } from '$core/api/types';
	import { getDraft, deleteDraft } from '$core/api/drafts';
	import {
		loadDraftDoc,
		restoreAttachmentFile,
		restoreDraftAttachments,
		DRAFT_DOC_VERSION,
		type DraftAttachmentMeta,
		type DraftDoc
	} from './draft';
	import { drafts, rowFromDoc } from '$core/stores/drafts.svelte';
	import { holdRestart } from '$core/stores/restartGuard';
	import { holdLeave } from '$core/stores/leaveGuard';
	import { onMount, untrack } from 'svelte';
	import {
		MAX_ATTACHMENT_BYTES,
		MAX_ATTACHMENTS,
		MAX_TOTAL_BYTES,
		UploadOrchestrator,
		type Attachment as ComposeAttachment
	} from './attachmentUpload';
	import type { Editor } from '@tiptap/core';

	export type ComposeView = 'float' | 'min' | 'expanded';

	interface Props {
		onClose: () => void;
		onSend: (info?: { scheduledAt?: string; forwardOf?: string }) => void;
		draftId?: string | null;
		forward?: ForwardRef | null;
		view?: ComposeView;
		onFocus?: () => void;
		onMinimize?: () => void;
		onExpand?: (expanded: boolean) => void;
		onDraftId?: (id: string) => void;
	}

	let {
		onClose,
		onSend,
		draftId = null,
		forward = null,
		view = 'float',
		onFocus,
		onMinimize,
		onExpand,
		onDraftId
	}: Props = $props();

	const min = $derived(view === 'min');
	const expanded = $derived(view === 'expanded');

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
	let pinnedFrom = $state<{ email: string; name: string } | null>(null);
	const fromRevoked = $derived(
		fromNeedsChoice(from, pinnedFrom?.email ?? null, (e) => !!addresses.getByEmail(e)?.suspended)
	);
	const revokedFrom = $derived.by(() => {
		const gone = fromRevoked ? from.unavailable : null;
		if (!gone) return null;
		if (pinnedFrom && pinnedFrom.email.toLowerCase() === gone.toLowerCase()) return pinnedFrom;
		const addr = addresses.getByEmail(gone);
		return { email: gone, name: addr ? sendIdentityOf(addr, auth.fullName).name : gone };
	});
	let fromOpen = $state(false);
	let fromPicker: ReturnType<typeof FromPicker> | undefined = $state();

	let to = $state<RecipientChip[]>([]);
	let cc = $state<RecipientChip[]>([]);
	let bcc = $state<RecipientChip[]>([]);
	let showCc = $state(false);
	let showBcc = $state(false);
	let subject = $state('');
	let warn = $state(false);
	let bodyEmpty = $state(true);
	let status = $state<'idle' | 'sending'>('idle');
	let err = $state<SendError | null>(null);
	let attempts = $state(0);
	let sendOpen = $state(false);
	let sendRef: HTMLDivElement | undefined = $state();
	let scheduleOpen = $state(false);
	let pendingScheduledAt = $state<string | null>(null);

	let bodyHtml = $state('');
	let bodyText = $state('');
	let editor: Editor | null = $state(null);
	let winRef: HTMLElement | undefined = $state();
	let seededSignature = $state(false);
	let signatureOn = $state(false);
	let signatureChosen = $state(false);

	const currentAddress = $derived(addresses.getByEmail(ident.email));
	const signatureBody = $derived(signatures.bodyFor(currentAddress?.id ?? null));

	$effect(() => {
		if (isDraftEdit) return;
		if (!editor) return;
		if (!currentAddress) return;
		if (!signatures.loaded) return;
		if (seededSignature) return;
		const body = signatures.effectiveFor(currentAddress.id, signatureKind);
		if (body) {
			applySignatureSeed(editor, body);
			signatureOn = true;
		}
		seededSignature = true;
	});

	function toggleSignature(next: boolean) {
		if (!editor) return;
		signatureChosen = true;
		signatureOn = next;
		if (next) insertSignature(editor, signatureBody);
		else removeSignature(editor);
	}

	function pickIdentity(email: string) {
		fromEmail = email;
		fromOpen = false;
		const picked = identityOptions.find((o) => o.email === email);
		pinnedFrom = { email, name: picked?.name ?? email };
		if (isDraftEdit || !editor) return;
		const addr = addresses.getByEmail(email);
		if (!addr) return;
		const body = signatures.bodyFor(addr.id);
		if (!seededSignature) {
			const seed = signatures.effectiveFor(addr.id, signatureKind);
			if (seed) {
				applySignatureSeed(editor, seed);
				signatureOn = true;
			}
			seededSignature = true;
			return;
		}
		const keep = signatureChosen ? signatureOn : signatures.effectiveFor(addr.id, signatureKind) !== null;
		signatureOn = keep && !!body.trim();
		swapSignatureForAddress(editor, signatureOn ? body : '');
	}

	let attachments = $state<ComposeAttachment[]>([]);
	let fileInput: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let attErr = $state<string | null>(null);
	const orchestrator = new UploadOrchestrator((a) => {
		attachments = attachments.map((x) => (x.id === a.id ? { ...a } : x));
	}, auth.accountId ?? '');

	const openedDraftId = untrack(() => draftId);
	const isDraftEdit = !!openedDraftId;
	const forwardDraft = untrack(
		() => !!openedDraftId && drafts.items.find((d) => d.id === openedDraftId)?.reply?.mode === 'forward'
	);
	const draftAccountId = untrack(() => auth.accountId) ?? '';
	const draftAccountEmail = untrack(() => auth.email) ?? '';
	let replyLink = $state<Pick<DraftDoc, 'inReplyToMessageId' | 'inReplyToHeader' | 'references' | 'reply'>>({});
	let fwd = $state<ForwardRef | null>(untrack(() => forward));
	const signatureKind = $derived<'new' | 'reply'>(fwd ? 'reply' : 'new');
	let fwdQuote = $state<ForwardQuote | null>(null);
	let fwdMsg = $state.raw<Message | null>(null);
	let fwdBody = $state<string | null>(null);
	let fwdFiles = $state.raw<{ name: string; size: number }[]>([]);
	let encOpen = $state(false);
	let fwdIds = $state<ReplyThreadIds | null>(null);
	let quoteRemoved = $state(false);
	let showQuote = $state(false);
	let refOpen = $state(typeof window !== 'undefined' && window.innerWidth >= 1200);
	let fwdReady: Promise<void> = Promise.resolve();
	const quoteSrcDoc = $derived(fwdQuote ? buildSrcDoc(fwdQuote.html, false) : null);
	const refSrcDoc = $derived(fwdBody === null ? null : buildSrcDoc(fwdBody, false));
	const withRef = $derived(expanded && refOpen && !!fwdQuote && !quoteRemoved);
	const backLabel = $derived(
		FOLDERS.find((f) => f.id === (page.params.folder ?? page.url.pathname.split('/mail/')[1]?.split('/')[0]))
			?.label ?? m.mail_skeleton_back()
	);

	const link = $derived.by<Pick<DraftDoc, 'inReplyToMessageId' | 'inReplyToHeader' | 'references' | 'reply'>>(() => {
		if (!fwd) return replyLink;
		const headers = fwdIds ? replyThreadHeaders(fwdIds) : null;
		return {
			inReplyToMessageId: headers?.inReplyToMessageId ?? fwd.seed,
			inReplyToHeader: headers?.inReplyToHeader,
			references: headers?.references,
			reply: { source: fwd.source, seed: fwd.seed, mode: 'forward', quoteRemoved }
		};
	});
	let load = $state<DraftLoad>(openedDraftId ? 'loading' : 'ready');
	let closing = $state(false);

	function chipsToRecipients(chips: RecipientChip[]) {
		return chips
			.filter((c) => c.email.trim())
			.map((c) => ({ name: c.name || undefined, address: c.email }));
	}

	function currentDoc(metas: DraftAttachmentMeta[]): DraftDoc {
		return {
			v: DRAFT_DOC_VERSION,
			from: revokedFrom ?? { email: ident.email, name: ident.name },
			to: chipsToRecipients(to),
			cc: chipsToRecipients(cc),
			bcc: chipsToRecipients(bcc),
			subject,
			bodyHtml,
			bodyText,
			...link,
			attachments: metas
		};
	}

	function draftKey(list: ComposeAttachment[]): string {
		return `${JSON.stringify(currentDoc([]))}|${attachmentSig(list)}`;
	}

	function isWorthSaving(doc: DraftDoc): boolean {
		if (fwd) return doc.to.length + doc.cc.length + doc.bcc.length > 0 || doc.bodyText.trim() !== '';
		return (
			doc.to.length > 0 ||
			doc.cc.length > 0 ||
			doc.bcc.length > 0 ||
			doc.subject.trim() !== '' ||
			doc.bodyText.trim() !== ''
		);
	}


	const saver = new DraftSaver(
		draftAccountId,
		{
			allowed: () => !!draftAccountId && autosaveAllowed(load, status === 'sending'),
			key: () => draftKey(attachments),
			worth: () => isWorthSaving(currentDoc([])),
			attachments: () => attachments,
			doc: currentDoc,
			saved: (id, doc) => {
				if (auth.accountId === draftAccountId) drafts.upsertLocal(rowFromDoc(id, doc));
			}
		},
		openedDraftId
	);

	const currentKey = $derived(draftKey(attachments));
	const dirty = $derived(
		currentKey !== saver.lastKey &&
			(saver.id !== null || attachments.length > 0 || isWorthSaving(currentDoc([])))
	);
	const saveFacts = $derived<DraftSaveFacts>({
		load,
		saving: saver.saving,
		failed: saver.failed,
		dirty,
		persisted: saver.persisted
	});
	const saveStatus = $derived(draftSaveStatus(saveFacts));
	const saveLabel = $derived(
		saveStatus === 'loading'
			? m.mail_compose_opening()
			: saveStatus === 'saving'
				? m.mail_compose_saving()
				: saveStatus === 'saved'
					? m.mail_compose_draft_saved()
					: saveStatus === 'failed'
						? m.mail_compose_not_saved()
						: saveStatus === 'unsaved'
							? m.mail_compose_unsaved()
							: m.mail_compose_draft()
	);

	function uploadsInFlight(): boolean {
		return attachments.some(
			(a) => a.status === 'queued' || a.status === 'encrypting' || a.status === 'uploading'
		);
	}

	function retrySave(): void {
		saver.cancel();
		void saver.save();
	}

	const attStatus = $derived(attachmentStatusText(attachments));
	const saveLine = $derived(attStatus && load === 'ready' ? `${saveLabel} · ${attStatus}` : saveLabel);

	function discardDraft(): void {
		const id = saver.release();
		if (id) {
			drafts.remove(id);
			void deleteDraft(id).catch(() => {});
		}
		onClose();
	}

	let confirmDiscard = $state(false);
	let fresh = $state(true);

	function askDiscard(): void {
		if (saver.id || attachments.length > 0 || isWorthSaving(currentDoc([]))) confirmDiscard = true;
		else discardDraft();
	}

	async function closeKeepingDraft(): Promise<void> {
		if (closing) return;
		if (load !== 'ready') {
			saver.cancel();
			onClose();
			return;
		}
		closing = true;
		try {
			await saver.settle();
		} finally {
			closing = false;
		}
		if (mayClose(saveFacts)) onClose();
	}

	$effect(() => {
		void to;
		void cc;
		void bcc;
		void subject;
		void bodyHtml;
		void attachmentSig(attachments);
		void ident.email;
		void ident.name;
		if (!autosaveAllowed(load, status === 'sending')) return;
		saver.schedule();
	});

	async function restartHold(): Promise<string | null> {
		if (status === 'sending') return m.mail_compose_hold_sending();
		if (uploadsInFlight()) return m.mail_compose_hold_uploading();
		if (load !== 'ready') return null;
		await saver.settle();
		if (!saver.id && attachments.length === 0 && !isWorthSaving(currentDoc([]))) return null;
		return draftKey(attachments) === saver.lastKey ? null : m.mail_compose_hold_draft_unsaved();
	}

	onMount(() => {
		void contacts.ensureLoaded();
		if (draftId) void hydrateDraft(draftId);
		else if (fwd) fwdReady = loadForward(fwd, true);
		const release = holdRestart(restartHold);
		const releaseLeave = holdLeave({
			pending: () => load === 'ready' && (dirty || saver.saving || saver.failed),
			settle: async () => {
				await saver.settle();
				return mayClose(saveFacts);
			},
			focus: () => {
				onFocus?.();
				editor?.commands.focus();
			}
		});
		return () => {
			releaseLeave();
			if (load === 'ready' && dirty) void saver.save();
			else saver.cancel();
			release();
		};
	});

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
		fwdFiles = files.map((f) => ({ name: f.name, size: f.size }));
		if (files.length) addFiles(files);
		if (failed) attErr = m.mail_compose_att_reattach_failed();
	}

	async function loadForward(ref: ForwardRef, fresh: boolean): Promise<void> {
		const accountId = draftAccountId;
		const ownName = auth.fullName ?? auth.email ?? '';
		const msg = await mailbox.ensureMessage(ref.seed).catch(() => null);
		fwdMsg = msg;
		if (fresh) {
			if (!subject.trim()) subject = forwardSubject(msg?.subj ?? '');
			const own = msg && addressedIdentity(msg, (a) => addresses.getByRecipient(a)?.email ?? null);
			if (own && fromEmail === null) fromEmail = own;
		}
		try {
			if (!accountId) throw new Error('no account');
			const { detail, render } = await loadMessageBody(accountId, ref.seed, {
				stripTracking: accountSettings.privacy.stripTrackingParams
			});
			fwdIds = {
				seedId: ref.seed,
				externalMessageId: detail.externalMessageId ?? undefined,
				references: detail.references ?? undefined
			};
			const fallback = forwardFallbackText(msg);
			fwdQuote =
				render.contentHtml || render.contentText
					? forwardQuote(msg, ownName, render.contentHtml, render.contentText)
					: forwardQuote(msg, ownName, undefined, fallback);
			fwdBody = render.contentHtml || plainToHtml(render.contentText || fallback);
			if (fresh) await attachForwarded(accountId, detail);
		} catch {
			fwdQuote = forwardQuote(msg, ownName, undefined, forwardFallbackText(msg));
			fwdBody = plainToHtml(forwardFallbackText(msg));
		}
	}

	async function hydrateDraft(id: string): Promise<void> {
		const accountId = draftAccountId;
		load = 'loading';
		if (!accountId) {
			load = 'failed';
			return;
		}
		try {
			const detail = await getDraft(id);
			const doc = await loadDraftDoc(accountId, detail);
			fromEmail = doc.from.email;
			pinnedFrom = doc.from;
			to = doc.to.map(recipientChip);
			cc = doc.cc.map(recipientChip);
			bcc = doc.bcc.map(recipientChip);
			if (cc.length) showCc = true;
			if (bcc.length) showBcc = true;
			subject = doc.subject;
			bodyHtml = doc.bodyHtml;
			bodyText = doc.bodyText;
			if (doc.reply?.mode === 'forward') {
				fwd = { source: doc.reply.source, seed: doc.reply.seed };
				quoteRemoved = !!doc.reply.quoteRemoved;
				fwdReady = loadForward(fwd, false);
				await fwdReady;
			} else {
				replyLink = {
					inReplyToMessageId: doc.inReplyToMessageId,
					inReplyToHeader: doc.inReplyToHeader,
					references: doc.references,
					reply: doc.reply
				};
			}
			let restoreFailed = false;
			if (doc.attachments.length > 0 && detail.attachmentsBundle) {
				try {
					const restored = await restoreDraftAttachments(accountId, doc, detail.attachmentsBundle);
					const added: ComposeAttachment[] = restored.map((r) => ({
						id: crypto.randomUUID(),
						file: r.file,
						status: 'queued',
						progress: 0,
						disposition: r.disposition,
						contentId: r.contentId
					}));
					attachments = [...attachments, ...added];
					for (const att of added) startUpload(att);
				} catch {
					restoreFailed = true;
					attErr = m.mail_compose_restore_att_failed({
						name: doc.attachments.map((a) => a.filename).join(', ')
					});
				}
			}
			if (restoreFailed) {
				saver.keepUnrestored(doc.attachments);
				saver.lastKey = draftKey(attachments);
			} else {
				saver.baseline(draftKey(attachments), attachments, doc.attachments);
			}
			load = 'ready';
		} catch {
			load = 'failed';
		} finally {
			if (editor) {
				signatureOn = hasSignature(editor);
				signatureChosen = true;
			}
			seededSignature = true;
		}
	}

	function formatSize(n: number): string {
		if (n >= 1024 * 1024) return m.mail_size_mb({ size: (n / (1024 * 1024)).toFixed(1) });
		if (n >= 1024) return m.mail_size_kb({ size: (n / 1024).toFixed(1) });
		return m.mail_size_bytes({ size: n });
	}

	function totalBytes(): number {
		return attachments.reduce((acc, a) => acc + a.file.size, 0);
	}

	function addFiles(files: FileList | File[]) {
		attErr = null;
		const incoming = Array.from(files);
		for (const file of incoming) {
			if (attachments.length >= MAX_ATTACHMENTS) {
				attErr = m.mail_compose_att_max_count({ count: MAX_ATTACHMENTS });
				return;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				attErr = m.mail_compose_att_too_large({ name: file.name, size: formatSize(MAX_ATTACHMENT_BYTES) });
				continue;
			}
			if (totalBytes() + file.size > MAX_TOTAL_BYTES) {
				attErr = m.mail_compose_att_total_too_large({ size: formatSize(MAX_TOTAL_BYTES) });
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
			startUpload(att);
		}
	}

	function recipientAddresses(): string[] {
		return [...to, ...cc, ...bcc].filter((c) => c.valid).map((c) => c.email);
	}

	function startUpload(att: ComposeAttachment) {
		orchestrator.startUpload(att, recipientAddresses(), Math.max(0, attachments.findIndex((x) => x.id === att.id)));
	}

	function removeAttachment(id: string) {
		attachments = attachments.filter((a) => a.id !== id);
	}

	function retryAttachment(id: string) {
		const a = attachments.find((x) => x.id === id);
		if (!a || (a.status !== 'error' && a.status !== 'cancelled')) return;
		startUpload(a);
	}

	function pickFiles() {
		fileInput?.click();
	}

	function onFileInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files) addFiles(input.files);
		input.value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) dragging = true;
	}

	function onDragLeave() {
		dragging = false;
	}

	const allRecipients = $derived([...to, ...cc, ...bcc]);
	const validCount = $derived(allRecipients.filter((c) => c.valid).length);
	const hasInvalid = $derived(allRecipients.some((c) => !c.valid));
	const block = $derived(sendBlock({ noSender, revokedFrom: revokedFrom?.email ?? null, attachments }));
	const canSend = $derived(validCount > 0 && !hasInvalid && status !== 'sending' && !block);
	const attention = $derived(dockAttention(block));

	function showBlock(): void {
		warn = true;
		if (!block) return;
		if (block.kind === 'from') fromPicker?.choose();
		else if (block.kind === 'attachment-failed') {
			const at = winRef?.querySelector<HTMLElement>(`[data-retry="${block.id}"]`);
			(at ?? winRef?.querySelector<HTMLElement>('.apv-card.failed .apv-act'))?.focus();
		}
	}

	function openSchedule(): void {
		sendOpen = false;
		if (!canSend) {
			showBlock();
			return;
		}
		scheduleOpen = true;
	}

	const subjLine = $derived(subject.trim() || m.mail_compose_new_message());

	const INLINE_CODES = new Set<SendError['code']>([
		'recipient_unknown',
		'account_key_stale',
		'account_key_unverified',
		'account_key_unchecked',
		'locked',
		'no_account',
		'encrypt',
		'encryption_downgrade',
		'recipient_key_invalid',
		'rate_limited',
		'schedule_unsupported',
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
		allRecipients.find((c) => c.valid) ?? { name: '', email: m.mail_compose_this_recipient() }
	);
	const failedAddress = $derived.by(() => {
		const p = err?.payload;
		if (!p) return null;
		if (
			p.kind === 'tofu' ||
			p.kind === 'directory' ||
			p.kind === 'external-key-change' ||
			p.kind === 'encryption_downgrade'
		) {
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
		warn = false;
		err = null;
	});

	function handleKey(e: KeyboardEvent) {
		if (min || !winRef || !(e.target instanceof Node) || !winRef.contains(e.target)) return;
		if (e.key === 'Escape') {
			if (fromOpen || sendOpen) {
				fromOpen = false;
				sendOpen = false;
				return;
			}
			if (!err) void closeKeepingDraft();
		}
	}

	function handleDocMouseDown(e: MouseEvent) {
		const t = e.target as Node;
		if (sendOpen && sendRef && !sendRef.contains(t)) sendOpen = false;
	}

	function focusTo() {
		const input = winRef?.querySelector<HTMLInputElement>('.recip-input');
		input?.focus();
	}

	const clearErr = () => {
		err = null;
		attempts = 0;
		pendingScheduledAt = null;
	};
	const editRecipient = () => {
		err = null;
		setTimeout(focusTo, 0);
	};
	const unlockVault = () => {
		err = null;
	};

	const acceptedKeys = new Map<string, string>();
	let approved: ApprovedModes = new Map();

	async function performSend(scheduledAt?: string | null) {
		const when = scheduledAt === undefined ? pendingScheduledAt : scheduledAt;
		if (fwd) await fwdReady;
		const bodyStr = bodyText.trim();
		const q = fwd && !quoteRemoved ? fwdQuote : null;
		if (!canSend || (!bodyStr && !q)) {
			showBlock();
			return;
		}
		const validTo = to.filter((c) => c.valid);
		const validCc = cc.filter((c) => c.valid);
		const validBcc = bcc.filter((c) => c.valid);
		if (validTo.length + validCc.length + validBcc.length === 0) {
			warn = true;
			return;
		}
		sendOpen = false;
		scheduleOpen = false;
		pendingScheduledAt = when;

		status = 'sending';
		err = null;
		const chip = (c: RecipientChip) => ({ display: c.name, address: c.email });
		try {
			if (attachments.length > 0) {
				await orchestrator.ensureRecipientCopies(attachments, recipientAddresses(), { acceptedKeys });
			}
			await dispatchSend(
				{
					to: validTo.map(chip),
					cc: validCc.length ? validCc.map(chip) : undefined,
					bcc: validBcc.length ? validBcc.map(chip) : undefined,
					subject: subject.trim(),
					body: q ? (bodyStr ? `${bodyStr}\n\n${q.text}` : q.text) : bodyStr,
					bodyHtml: (q ? `${bodyStr || hasRenderableHtml(bodyHtml) ? bodyHtml : ''}${q.html}` : bodyHtml) || undefined,
					attachments: attachments.length > 0 ? attachments : undefined,
					fromEmail: ident.email,
					fromName: ident.name,
					fromAliasId: ident.aliasId,
					inReplyToMessageId: link.inReplyToMessageId,
					inReplyToHeader: link.inReplyToHeader,
					references: link.references,
					scheduledAt: when ?? undefined
				},
				{ acceptedKeys, approved }
			);
			status = 'idle';
			attempts = 0;
			pendingScheduledAt = null;
			const sentDraftId = saver.release();
			if (sentDraftId) {
				const id = sentDraftId;
				drafts.remove(id);
				void deleteDraft(id).catch(() => {});
			}
			onSend({
				...(when ? { scheduledAt: when } : {}),
				...(fwd ? { forwardOf: fwd.source } : {})
			});
		} catch (e) {
			status = 'idle';
			platform.reportError?.('send', e);
			if (e instanceof SendError) {
				err = e;
				if (e.code === 'encryption_downgrade') encTracker.recheck(recipientAddresses());
				if (e.code === 'encrypt') attempts += 1;
				else attempts = 0;
			} else {
				err = new SendError('unknown', e instanceof Error ? e.message : m.mail_compose_send_failed());
				attempts = 0;
			}
		}
	}

	const encTracker = new EncStatusTracker();

	$effect(() => {
		encTracker.track(allRecipients.filter((c) => c.valid).map((c) => c.email));
	});

	function encStatusFor(email: string): RecipientEncStatus {
		return encTracker.statusFor(email);
	}

	const encStatuses = $derived(
		allRecipients.filter((c) => c.valid).map((c) => encStatusFor(c.email))
	);

	const encSummary = $derived(summarizeEncryption(encStatuses));

	let guards = $state<SendGuard[]>([]);
	let guardedRun: (() => void) | null = null;

	let settlingKeys = false;

	function guardedSend(run: () => void): void {
		if (!canSend || (!bodyText.trim() && !fwd)) {
			run();
			return;
		}
		if (settlingKeys) return;
		if (encStatuses.some((s) => s === 'checking' || s === 'failed')) {
			settlingKeys = true;
			void encTracker
				.settle(allRecipients.filter((c) => c.valid).map((c) => c.email))
				.then(() => {
					settlingKeys = false;
					evaluateGuards(run);
				});
			return;
		}
		evaluateGuards(run);
	}

	function evaluateGuards(run: () => void): void {
		approved = encTracker.approvals(recipientAddresses());
		const next = pendingSendGuards({
			settings: accountSettings.composing,
			statuses: encStatuses,
			subject
		});
		if (next.length === 0) {
			run();
			return;
		}
		sendOpen = false;
		scheduleOpen = false;
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

	const runSend = () => guardedSend(() => performSend(null));
	const retrySend = () => performSend();
	const scheduleSend = (when: Date) => guardedSend(() => performSend(when.toISOString()));
	const trustAndSend = () => {
		const payload = err?.payload;
		if (payload?.kind === 'tofu') acceptedKeys.set(payload.address, payload.currentFingerprintHex);
		return performSend();
	};
	async function acceptExternalAndSend() {
		const payload = err?.payload;
		if (payload?.kind === 'external-key-change') {
			try {
				await acceptExternalKey(payload.address, payload.currentFingerprintB64);
			} catch {
				err = new SendError('unknown', m.mail_compose_accept_key_failed());
				return;
			}
		}
		await performSend();
	}

	$effect(() => {
		bodyEmpty = !bodyText.trim();
	});

	$effect(() => {
		const id = saver.id;
		if (id) untrack(() => onDraftId?.(id));
	});
</script>

<svelte:document onkeydown={handleKey} onmousedown={handleDocMouseDown} />

{#if min}
	<div
		class="compose-dock"
		role="button"
		tabindex="0"
		onclick={() => onFocus?.()}
		onkeydown={(e) => {
			if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
				e.preventDefault();
				onFocus?.();
			}
		}}
	>
		<PenLine size={15} />
		<span class="dock-t">{subjLine}</span>
		{#if attention}<span class="dock-flag"><CircleAlert size={13} />{attention}</span>{/if}
		<button
			type="button"
			class="dock-b"
			title={m.mail_compose_open()}
			onclick={(e) => {
				e.stopPropagation();
				onFocus?.();
			}}><ChevronUp size={16} /></button
		>
		<button
			type="button"
			class="dock-b"
			title={m.common_close()}
			aria-busy={closing}
			onclick={(e) => {
				e.stopPropagation();
				void closeKeepingDraft();
			}}><X size={16} /></button
		>
	</div>
{/if}

<div
	bind:this={winRef}
	class="compose-win"
	class:fresh
	class:expanded
	class:with-ref={withRef}
	hidden={min}
	role="dialog"
	aria-modal="false"
	tabindex="-1"
	aria-label={subjLine}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	onanimationend={(e) => {
		if (e.target === e.currentTarget) fresh = false;
	}}
>
	{#if withRef}
		<aside class="compose-ref" aria-label={m.mail_forwarded_chip()}>
			<div class="cref-h">
				<ArrowLeft size={16} /><span>{m.mail_forwarded_chip()}</span>
				<button type="button" class="chx" title={m.mail_compose_hide_forwarded()} onclick={() => (refOpen = false)}>
					<X size={16} />
				</button>
			</div>
			<div class="cref-b">
				{#if fwdMsg}
					<h3 class="cref-subj">{fwdMsg.subj}</h3>
					<div class="cref-from">
						<Avatar initials={initialsFor(fwdMsg.from, fwdMsg.fromAddr)} size={36} />
						<span class="cref-who">
							<b>{fwdMsg.from}</b>
							<span>{fwdMsg.fromAddr}</span>
						</span>
						<span class="cref-date">{formatWhenLong(new Date(fwdMsg.epoch))}</span>
					</div>
				{/if}
				{#if refSrcDoc}
					<EmailBody srcDoc={refSrcDoc} />
				{:else if quoteSrcDoc}
					<EmailBody srcDoc={quoteSrcDoc} />
				{/if}
				{#each fwdFiles as f (f.name + f.size)}
					<div class="cref-file">
						<Paperclip size={18} />
						<span class="cref-ft"><b>{f.name}</b><span>{formatSize(f.size)}</span></span>
					</div>
				{/each}
			</div>
		</aside>
	{/if}
	<div class="compose-h">
		{#if expanded}
			<button type="button" class="ch-back" onclick={() => onExpand?.(false)}>
				<ArrowLeft size={16} />{backLabel}
			</button>
		{/if}
		<h2 class="ch-t">{fwd || forwardDraft ? m.mail_reader_forward() : m.mail_compose_new_message()}</h2>
		{#if draftAccountEmail}
			<span class="ch-acct" title={draftAccountEmail}>{m.mail_compose_in_account({ account: draftAccountEmail })}</span>
		{/if}
		<span class="ch-save" data-state={saveStatus} class:att={!!attStatus} role="status">
			{#if attStatus || saveStatus === 'failed'}<CircleAlert size={14} />{:else if saveStatus === 'saved'}<Check size={14} />{/if}{saveLine}
		</span>
		<span class="ch-rule" aria-hidden="true"></span>
		<div class="ch-actions">
			{#if expanded && fwdQuote && !quoteRemoved}
				<button
					type="button"
					class="chx"
					class:on={refOpen}
					title={refOpen ? m.mail_compose_hide_forwarded() : m.mail_compose_show_forwarded()}
					aria-pressed={refOpen}
					onclick={() => (refOpen = !refOpen)}
				>
					<PanelLeft size={16} />
				</button>
			{/if}
			<button type="button" class="chx" title={m.mail_compose_minimize()} onclick={() => onMinimize?.()}>
				<Minus size={16} />
			</button>
			<button
				type="button"
				class="chx size"
				title={expanded ? m.mail_compose_collapse() : m.mail_compose_expand()}
				aria-pressed={expanded}
				onclick={() => onExpand?.(!expanded)}
			>
				{#if expanded}<Minimize2 size={16} />{:else}<Maximize2 size={16} />{/if}
			</button>
			<button type="button" class="chx x" title={m.common_close()} aria-busy={closing} onclick={() => void closeKeepingDraft()}>
				<X size={16} />
			</button>
		</div>
	</div>

		{#if load === 'failed'}
			<div class="cwarn" role="alert">
				<CircleAlert size={14} />
				<span class="cwarn-t">{m.mail_compose_open_draft_failed()} {m.mail_compose_draft_untouched()}</span>
				<button type="button" class="cwarn-act" onclick={() => draftId && void hydrateDraft(draftId)}>
					{m.common_retry()}
				</button>
			</div>
		{/if}

		<div class="compose-scroll" inert={load !== 'ready'} aria-busy={load === 'loading'}>
			<FromPicker
				bind:this={fromPicker}
				bind:open={fromOpen}
				options={identityOptions}
				current={ident}
				revoked={revokedFrom}
				{noSender}
				account={draftAccountEmail}
				avatarUrl={auth.avatarUrl}
				onPick={pickIdentity}
				onManage={() => void goto(`/u/${page.params.slot ?? '0'}/settings/addresses`)}
			/>

			{#snippet ccBccSlot()}
				<div class="ccbcc">
					{#if !showCc}
						<button type="button" onclick={() => (showCc = true)}>{m.mail_recip_cc()}</button>
					{/if}
					{#if !showBcc}
						<button type="button" onclick={() => (showBcc = true)}>{m.mail_recip_bcc()}</button>
					{/if}
				</div>
			{/snippet}

			<RecipientField
				label="To"
				chips={to}
				setChips={(next) => (to = next)}
				contacts={contacts.items}
				autoFocus
				rightSlot={ccBccSlot}
				{encStatusFor}
			/>

			{#if showCc}
				<RecipientField
					label="Cc"
					chips={cc}
					setChips={(next) => (cc = next)}
					contacts={contacts.items}
					autoFocus
					{encStatusFor}
					onRemoveField={() => {
						cc = [];
						showCc = false;
					}}
				/>
			{/if}

			{#if showBcc}
				<RecipientField
					label="Bcc"
					chips={bcc}
					setChips={(next) => (bcc = next)}
					contacts={contacts.items}
					autoFocus
					{encStatusFor}
					onRemoveField={() => {
						bcc = [];
						showBcc = false;
					}}
				/>
			{/if}

			<div class="cenc" data-tone={encSummary.tone}>
				{#if encSummary.tone === 'none' || encSummary.tone === 'partial'}
					<Mail size={15} />
				{:else if encSummary.tone === 'unknown'}
					<CircleAlert size={15} />
				{:else}
					<Lock size={15} />
				{/if}
				<span class="cenc-t">{encSummary.label}</span>
				<button type="button" class="cenc-d" aria-expanded={encOpen} onclick={() => (encOpen = !encOpen)}>
					{m.mail_compose_enc_details()}
				</button>
			</div>
			{#if encOpen}
				<p class="cenc-more">{encSummary.title}</p>
			{/if}

			<div class="cfield subj">
				<span class="recip-label">{m.mail_compose_subject()}</span>
				<input bind:value={subject} placeholder={m.mail_compose_subject()} />
			</div>

			<RichEditor
				bind:html={bodyHtml}
				bind:text={bodyText}
				bind:editor
				placeholder={fwd || forwardDraft ? m.mail_compose_add_note() : m.mail_editor_placeholder()}
				disabled={status === 'sending'}
			/>

			{#if fwdQuote && !quoteRemoved}
				<div class="rq">
					<button
						type="button"
						class="quoted-toggle"
						class:on={expanded ? refOpen : showQuote}
						title={(expanded ? refOpen : showQuote)
							? m.mail_compose_hide_forwarded()
							: m.mail_compose_show_forwarded()}
						aria-expanded={expanded ? refOpen : showQuote}
						onclick={() => {
							if (expanded) refOpen = !refOpen;
							else showQuote = !showQuote;
						}}
					>
						<Ellipsis size={16} />
					</button>
					<span class="rq-lbl">{m.mail_forwarded_chip()}</span>
					<button
						type="button"
						class="rq-rm"
						title={m.mail_compose_remove_quoted()}
						onclick={() => {
							quoteRemoved = true;
							showQuote = false;
						}}
					>
						<X size={13} />
					</button>
				</div>
				{#if showQuote && !expanded && quoteSrcDoc}
					<div class="rq-view">
						<EmailBody srcDoc={quoteSrcDoc} />
					</div>
				{/if}
			{/if}

			<AttachPreview files={attachments} onRemove={removeAttachment} onRetry={retryAttachment} rows />

			{#if attErr}
				<div class="cwarn"><CircleAlert size={14} />{attErr}</div>
			{/if}

			{#if status === 'sending'}
				<SendingVeil />
			{/if}

			{#if dragging}
				<div class="att-drop">{m.mail_compose_drop()}</div>
			{/if}
		</div>

		<input
			bind:this={fileInput}
			type="file"
			multiple
			class="att-hidden-input"
			onchange={onFileInputChange}
		/>

		<EditorToolbar
			{editor}
			signature={{
				present: !!signatureBody.trim(),
				on: signatureOn,
				onToggle: toggleSignature
			}}
		>
			{#snippet extra()}
				<button type="button" class="cbar-lab" onclick={pickFiles}>
					<Paperclip size={16} />{m.mail_compose_attach()}
				</button>
			{/snippet}
		</EditorToolbar>

		{#if warn && !canSend && block?.kind !== 'no-sender' && status !== 'sending'}
			<div class="cwarn" role="alert">
				<CircleAlert size={14} />
				{block
					? sendBlockText(block)
					: hasInvalid
						? m.mail_compose_invalid_addresses()
						: m.mail_compose_need_recipient_and_body()}
			</div>
		{/if}

		{#if inlineErr}
			<InlineSendError
				code={inlineErr.code as InlineErrorCode}
				{attempts}
				recipient={modalRecip}
				retryAfterSeconds={inlineRetryAfter}
				message={inlineErr.message}
				onEditRecipient={editRecipient}
				onUnlock={unlockVault}
				onRetry={retrySend}
				onDismiss={clearErr}
			/>
		{:else if err && err.code === 'unknown'}
			<div class="cwarn">
				<CircleAlert size={14} />
				{err.message}
			</div>
		{/if}

		{#if saveStatus === 'failed'}
			<div class="cwarn" role="alert">
				<CircleAlert size={14} />
				<span class="cwarn-t">{m.mail_compose_save_failed()}</span>
				<button type="button" class="cwarn-act" onclick={retrySave}>{m.common_retry()}</button>
			</div>
		{/if}

		<div class="compose-f" inert={load !== 'ready'}>
			<div
				class="send-split"
				class:off={!canSend}
				class:sending={status === 'sending'}
				bind:this={sendRef}
			>
				<button
					type="button"
					class="send"
					onclick={runSend}
					disabled={status === 'sending'}
					aria-disabled={!canSend}
				>
					{#if status === 'sending'}
						<span class="send-spin"></span>{m.mail_compose_sending()}
					{:else}
						<Send size={16} />{m.mail_compose_send()}
					{/if}
				</button>
				<button
					type="button"
					class="send-caret"
					title={m.mail_compose_send_options()}
					disabled={status === 'sending'}
					aria-disabled={!canSend}
					onclick={() => {
						if (canSend) sendOpen = !sendOpen;
						else showBlock();
					}}
				>
					<ChevronDown size={15} />
				</button>
				{#if sendOpen}
					<div class="send-menu" role="menu">
						<button type="button" onclick={runSend}><Send size={16} />{m.mail_compose_send_now()}</button>
						<button type="button" onclick={openSchedule}><Clock size={16} />{m.mail_compose_schedule()}</button>
					</div>
				{/if}
			</div>

			<button
				type="button"
				class="cf-sched"
				class:off={!canSend}
				disabled={status === 'sending'}
				aria-disabled={!canSend}
				onclick={openSchedule}
			>
				<Clock size={16} />{m.mail_compose_schedule()}
			</button>

			<button type="button" class="cf-disc" onclick={askDiscard}>
				<Trash2 size={16} />{m.mail_compose_discard_draft()}
			</button>
		</div>
</div>

{#snippet discardBody()}
	<p class="cfd-p">{m.mail_compose_discard_body()}</p>
{/snippet}

{#if confirmDiscard}
	<ConfirmDialog
		icon={Trash2}
		title={m.mail_compose_discard_title()}
		sub={subjLine}
		tone="danger"
		confirmLabel={m.mail_compose_discard_draft()}
		body={discardBody}
		onConfirm={() => {
			confirmDiscard = false;
			discardDraft();
		}}
		onClose={() => (confirmDiscard = false)}
	/>
{/if}

{#if guards.length > 0}
	<SendGuardDialog {guards} onConfirm={confirmGuards} onCancel={cancelGuards} />
{/if}

{#if scheduleOpen}
	<SchedulePicker
		busy={status === 'sending'}
		onSchedule={scheduleSend}
		onClose={() => (scheduleOpen = false)}
	/>
{/if}

{#if err && err.code === 'directory_verification_failed' && err.payload?.kind === 'directory'}
	<DirectoryFailModal
		inner={err.inner ?? 'unknown'}
		recipient={modalRecip}
		requestedAddress={err.payload.requestedAddress}
		statementAddress={err.payload.statementAddress}
		signedKeyFingerprint={err.payload.signedKeyFingerprint}
		servedKeyFingerprint={err.payload.servedKeyFingerprint}
		expectedSignerFingerprint={err.payload.expectedSignerFingerprint}
		actualSignerFingerprint={err.payload.actualSignerFingerprint}
		previousFingerprint={err.payload.previousFingerprint}
		currentFingerprint={err.payload.currentFingerprint}
		keyAlgorithm={err.payload.keyAlgorithm}
		servedKeyAlgorithm={err.payload.servedKeyAlgorithm}
		statementField={err.payload.statementField}
		seenVersion={err.payload.seenVersion}
		servedVersion={err.payload.servedVersion}
		onEditRecipient={editRecipient}
		onRetry={retrySend}
		onCancel={clearErr}
	/>
{/if}

{#if err && err.code === 'tofu' && err.payload?.kind === 'tofu'}
	<TofuModal
		recipient={modalRecip}
		previousFingerprint={err.payload.previousFingerprint}
		previousLastSeen={err.payload.previousLastSeen}
		previousFirstSeen={null}
		currentFingerprint={err.payload.currentFingerprint}
		shared={err.payload.shared}
		onSendAnyway={trustAndSend}
		onCancel={clearErr}
	/>
{/if}

{#if err && err.code === 'external_key_change' && err.payload?.kind === 'external-key-change'}
	<TofuModal
		recipient={{ name: '', email: err.payload.address }}
		previousFingerprint={err.payload.previousFingerprint}
		previousLastSeen={null}
		previousFirstSeen={err.payload.previousFirstSeen}
		currentFingerprint={err.payload.currentFingerprint}
		shared={false}
		onSendAnyway={acceptExternalAndSend}
		onCancel={clearErr}
	/>
{/if}
