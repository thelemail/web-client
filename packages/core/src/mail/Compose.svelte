<script lang="ts">
	import { trapFocus } from '$core/actions/trapFocus';
	import { m } from '$paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import X from '@lucide/svelte/icons/x';
	import Minus from '@lucide/svelte/icons/minus';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Send from '@lucide/svelte/icons/send';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import Link from '@lucide/svelte/icons/link';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Check from '@lucide/svelte/icons/check';
	import AtSign from '@lucide/svelte/icons/at-sign';
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
	import TofuModal from './TofuModal.svelte';
	import RichEditor from './editor/RichEditor.svelte';
	import EditorToolbar from './editor/EditorToolbar.svelte';
	import AttachPreview from './AttachPreview.svelte';
	import { recipientChip, type RecipientChip, type SendIdentity } from './data';
	import { contacts } from '$core/stores/contacts.svelte';
	import { initialsFor } from './initials';
	import { chooseFrom, sendIdentityOf } from './identities';
	import { auth } from '$core/stores/auth.svelte';
	import { addresses } from '$core/stores/addresses.svelte';
	import { signatures } from '$core/stores/signatures.svelte';
	import { SendError } from './send';
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
		hasSignature
	} from './signatureRegion';
	import { getDraft, deleteDraft } from '$core/api/drafts';
	import {
		loadDraftDoc,
		restoreDraftAttachments,
		DRAFT_DOC_VERSION,
		type DraftAttachmentMeta,
		type DraftDoc
	} from './draft';
	import { drafts, type DraftRow } from '$core/stores/drafts.svelte';
	import { holdRestart } from '$core/stores/restartGuard';
	import { onMount, untrack } from 'svelte';
	import {
		MAX_ATTACHMENT_BYTES,
		MAX_ATTACHMENTS,
		MAX_TOTAL_BYTES,
		UploadOrchestrator,
		type Attachment as ComposeAttachment
	} from './attachmentUpload';
	import type { Editor } from '@tiptap/core';
	import LinkDialog from './editor/LinkDialog.svelte';
	import { applyLink, currentLink } from './editor/link';

	interface Props {
		onClose: () => void;
		onSend: (info?: { scheduledAt?: string }) => void;
		draftId?: string | null;
	}

	let { onClose, onSend, draftId = null }: Props = $props();

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
	let fromOpen = $state(false);
	let fromRef: HTMLDivElement | undefined = $state();

	let to = $state<RecipientChip[]>([]);
	let cc = $state<RecipientChip[]>([]);
	let bcc = $state<RecipientChip[]>([]);
	let showCc = $state(false);
	let showBcc = $state(false);
	let subject = $state('');
	let min = $state(false);
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
	let winRef: HTMLDivElement | undefined = $state();
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
		const body = signatures.effectiveFor(currentAddress.id, 'new');
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
		if (isDraftEdit || !editor) return;
		const addr = addresses.getByEmail(email);
		if (!addr) return;
		const body = signatures.bodyFor(addr.id);
		if (!seededSignature) {
			const seed = signatures.effectiveFor(addr.id, 'new');
			if (seed) {
				applySignatureSeed(editor, seed);
				signatureOn = true;
			}
			seededSignature = true;
			return;
		}
		const keep = signatureChosen ? signatureOn : signatures.effectiveFor(addr.id, 'new') !== null;
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
	const draftAccountId = untrack(() => auth.accountId) ?? '';
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
			from: { email: ident.email, name: ident.name },
			to: chipsToRecipients(to),
			cc: chipsToRecipients(cc),
			bcc: chipsToRecipients(bcc),
			subject,
			bodyHtml,
			bodyText,
			attachments: metas
		};
	}

	function draftKey(list: ComposeAttachment[]): string {
		return `${JSON.stringify(currentDoc([]))}|${attachmentSig(list)}`;
	}

	function isWorthSaving(doc: DraftDoc): boolean {
		return (
			doc.to.length > 0 ||
			doc.cc.length > 0 ||
			doc.bcc.length > 0 ||
			doc.subject.trim() !== '' ||
			doc.bodyText.trim() !== ''
		);
	}

	function draftRowFromDoc(id: string, doc: DraftDoc): DraftRow {
		const now = new Date();
		const recips = [...doc.to, ...doc.cc, ...doc.bcc].map((r) => r.name || r.address);
		const summary =
			recips.length === 0
				? m.mail_no_recipients()
				: recips.length <= 2
					? recips.join(', ')
					: `${recips.slice(0, 2).join(', ')} +${recips.length - 2}`;
		return {
			id,
			subject: doc.subject.trim() || m.mail_compose_no_subject(),
			snippet: doc.bodyText.slice(0, 280),
			to: summary,
			updatedAt: now.toISOString(),
			epoch: now.getTime(),
			attachmentCount: doc.attachments.length,
			init: initialsFor(doc.subject || '', '')
		};
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
				if (auth.accountId === draftAccountId) drafts.upsertLocal(draftRowFromDoc(id, doc));
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

	function uploadsInFlight(): boolean {
		return attachments.some(
			(a) => a.status === 'queued' || a.status === 'encrypting' || a.status === 'uploading'
		);
	}

	function retrySave(): void {
		saver.cancel();
		void saver.save();
	}

	function discardDraft(): void {
		const id = saver.release();
		if (id) {
			drafts.remove(id);
			void deleteDraft(id).catch(() => {});
		}
		onClose();
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
		const release = holdRestart(restartHold);
		return () => {
			if (load === 'ready' && dirty) void saver.save();
			else saver.cancel();
			release();
		};
	});

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
			to = doc.to.map(recipientChip);
			cc = doc.cc.map(recipientChip);
			bcc = doc.bcc.map(recipientChip);
			if (cc.length) showCc = true;
			if (bcc.length) showBcc = true;
			subject = doc.subject;
			bodyHtml = doc.bodyHtml;
			bodyText = doc.bodyText;
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
		orchestrator.startUpload(att, recipientAddresses(), Math.max(0, attachments.indexOf(att)));
	}

	function removeAttachment(id: string) {
		attachments = attachments.filter((a) => a.id !== id);
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
	const attReady = $derived(attachments.every((a) => a.status === 'ready'));
	const canSend = $derived(
		validCount > 0 && !hasInvalid && status !== 'sending' && attReady && !noSender
	);
	function identityKindLabel(kind: SendIdentity['kind']): string {
		if (kind === 'Alias') return m.mail_compose_ident_shared();
		if (kind === 'Identity') return m.mail_compose_ident_identity();
		return m.mail_compose_ident_default();
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
		warn = false;
		err = null;
	});

	function handleKey(e: KeyboardEvent) {
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
		if (fromOpen && fromRef && !fromRef.contains(t)) fromOpen = false;
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

	async function performSend(scheduledAt?: string | null) {
		const when = scheduledAt === undefined ? pendingScheduledAt : scheduledAt;
		const bodyStr = bodyText.trim();
		if (!canSend || !bodyStr) {
			warn = true;
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
					body: bodyStr,
					bodyHtml: bodyHtml || undefined,
					attachments: attachments.length > 0 ? attachments : undefined,
					fromEmail: ident.email,
					fromName: ident.name,
					fromAliasId: ident.aliasId,
					scheduledAt: when ?? undefined
				},
				{ acceptedKeys }
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
			onSend(when ? { scheduledAt: when } : undefined);
		} catch (e) {
			status = 'idle';
			platform.reportError?.('send', e);
			if (e instanceof SendError) {
				err = e;
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
		if (!canSend || !bodyText.trim()) {
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

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) void closeKeepingDraft();
	}

	let linkInitial = $state<string | null>(null);

	function insertLink() {
		if (!editor) return;
		linkInitial = currentLink(editor);
	}

	function closeLink() {
		linkInitial = null;
		editor?.commands.focus();
	}

	function submitLink(url: string) {
		linkInitial = null;
		if (editor) applyLink(editor, url);
	}
</script>

<svelte:document onkeydown={handleKey} onmousedown={handleDocMouseDown} />

{#if linkInitial !== null}
	<LinkDialog initial={linkInitial} onApply={submitLink} onClose={closeLink} />
{/if}

{#if min}
	<div
		class="compose-dock"
		role="button"
		tabindex="0"
		onclick={() => (min = false)}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				min = false;
			}
		}}
	>
		<PenLine size={15} />
		<span class="dock-t">{subjLine}</span>
		<button
			type="button"
			class="dock-b"
			title={m.mail_compose_expand()}
			onclick={(e) => {
				e.stopPropagation();
				min = false;
			}}><ChevronUp size={16} /></button
		>
		<button
			type="button"
			class="dock-b"
			title={m.mail_compose_discard()}
			onclick={(e) => {
				e.stopPropagation();
				discardDraft();
			}}><X size={16} /></button
		>
	</div>
{:else}
	<div
		class="mail-scrim"
		role="dialog"
		aria-modal="true"
		aria-label={m.mail_compose_new_message()}
		use:trapFocus
		tabindex="-1"
		onmousedown={scrimMouseDown}
	>
		<div
			bind:this={winRef}
			class="compose-win"
			role="presentation"
			onmousedown={(e) => e.stopPropagation()}
			ondragover={onDragOver}
			ondragleave={onDragLeave}
			ondrop={onDrop}
		>
			<div class="compose-h">
				<PenLine size={16} />{m.mail_compose_new_message()}
				<div class="ch-actions">
					<button type="button" class="chx" title={m.mail_compose_minimize()} onclick={() => (min = true)}>
						<Minus size={16} />
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
				<div class="from-row" bind:this={fromRef}>
					<span class="recip-label">{m.mail_compose_from()}</span>
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
							size={22}
							bg={ident.bg}
							fg={ident.fg}
						/>
						<span class="ft-name">{ident.name}</span>
						<span class="ft-email">&lt;{ident.email}&gt;</span>
						<ChevronDown size={15} />
					</button>
					{#if fromOpen}
						<div class="from-menu" role="menu">
							<div class="fm-h">{m.mail_compose_send_as()}</div>
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
										{#if id.org}<span class="fm-org">{id.org}</span>{/if}
									</span>
									{#if id.email === ident.email}<Check size={17} />{/if}
								</button>
							{/each}
							<div class="fm-sep"></div>
							<button
								type="button"
								class="fm-add"
								onclick={() => {
									fromOpen = false;
									void goto(`/u/${page.params.slot ?? '0'}/settings/addresses`);
								}}
							>
								<AtSign size={16} />{m.mail_compose_manage_addresses()}
							</button>
						</div>
					{/if}
				</div>
				{#if noSender}
					<div class="cnote"><CircleAlert size={14} />{m.mail_compose_no_sender()}</div>
				{:else if fromNotice}
					<div class="cnote">
						<CircleAlert size={14} />{m.mail_compose_from_unavailable({
							address: fromNotice,
							from: ident.email
						})}
					</div>
				{/if}

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

				<div class="cfield subj">
					<span class="recip-label">{m.mail_compose_subject()}</span>
					<input bind:value={subject} placeholder={m.mail_compose_subject()} />
				</div>

				<RichEditor
					bind:html={bodyHtml}
					bind:text={bodyText}
					bind:editor
					placeholder={m.mail_editor_placeholder()}
					disabled={status === 'sending'}
				/>

				<AttachPreview files={attachments} onRemove={removeAttachment} />

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
			/>

			{#if warn && !canSend && !noSender && status !== 'sending'}
				<div class="cwarn">
					<CircleAlert size={14} />
					{hasInvalid
						? m.mail_compose_invalid_addresses()
						: m.mail_compose_need_recipient_and_body()}
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
						disabled={status === 'sending' || !canSend}
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
						disabled={!canSend || status === 'sending'}
						onclick={() => {
							if (canSend && status !== 'sending') sendOpen = !sendOpen;
						}}
					>
						<ChevronUp size={15} />
					</button>
					{#if sendOpen}
						<div class="send-menu" role="menu">
							<button type="button" onclick={runSend}><Send size={16} />{m.mail_compose_send_now()}</button>
							<button
								type="button"
								onclick={() => {
									sendOpen = false;
									scheduleOpen = true;
								}}><Clock size={16} />{m.mail_compose_schedule()}</button
							>
						</div>
					{/if}
				</div>

				<button type="button" class="cf-ico" title={m.mail_compose_attach_files()} onclick={pickFiles}>
					<Paperclip size={17} />
				</button>

				<button type="button" class="cf-ico" title={m.mail_toolbar_link()} onclick={insertLink}>
					<Link size={17} />
				</button>

				<span class="cf-enc" data-tone={encSummary.tone} title={encSummary.title}>
					{#if encSummary.tone === 'partial' || encSummary.tone === 'none'}
						<LockOpen size={16} />
					{:else if encSummary.tone === 'unknown'}
						<CircleAlert size={16} />
					{:else}
						<Lock size={16} />
					{/if}
					<span class="cf-enc-t">{encSummary.label}</span>
				</span>

				<span class="csave" data-state={saveStatus} role="status"
					>{saveStatus === 'loading'
						? m.mail_compose_opening()
						: saveStatus === 'saving'
							? m.mail_compose_saving()
							: saveStatus === 'saved'
								? m.mail_compose_draft_saved()
								: saveStatus === 'failed'
									? m.mail_compose_not_saved()
									: saveStatus === 'unsaved'
										? m.mail_compose_unsaved()
										: m.mail_compose_draft()}</span
				>
				<button type="button" class="cf-ico danger" title={m.mail_compose_discard_draft()} onclick={discardDraft}>
					<Trash2 size={17} />
				</button>
			</div>
		</div>
	</div>

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
{/if}
