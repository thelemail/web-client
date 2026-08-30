<script lang="ts">
	import { goto } from '$app/navigation';
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
	import Avatar from './Avatar.svelte';
	import RecipientField from './RecipientField.svelte';
	import SendingVeil from './SendingVeil.svelte';
	import InlineSendError, { type InlineErrorCode } from './InlineSendError.svelte';
	import DirectoryFailModal from './DirectoryFailModal.svelte';
	import SchedulePicker from './SchedulePicker.svelte';
	import TofuModal from './TofuModal.svelte';
	import RichEditor from './editor/RichEditor.svelte';
	import EditorToolbar from './editor/EditorToolbar.svelte';
	import AttachPreview from './AttachPreview.svelte';
	import { recipientChip, type RecipientChip, type SendIdentity } from './data';
	import { contacts } from '$lib/stores/contacts.svelte';
	import { initialsFor } from './initials';
	import { auth } from '$lib/stores/auth.svelte';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { signatures } from '$lib/stores/signatures.svelte';
	import { SendError } from './send';
	import { dispatchSend } from './sendDispatch';
	import { acceptExternalKey } from '$lib/api/externalKeys';
	import type { RecipientEncStatus } from './RecipientField.svelte';
	import { EncStatusTracker } from './encStatus.svelte';
	import { summarizeEncryption } from './encSummary';
	import { applySignatureSeed, swapSignatureForAddress } from './signatureRegion';
	import { getDraft, putDraft, deleteDraft } from '$lib/api/drafts';
	import { buildDraftEnvelope, loadDraftDoc, restoreAttachmentFile, type DraftDoc } from './draft';
	import { drafts, type DraftRow } from '$lib/stores/drafts.svelte';
	import { onMount } from 'svelte';
	import {
		MAX_ATTACHMENT_BYTES,
		MAX_ATTACHMENTS,
		MAX_TOTAL_BYTES,
		UploadOrchestrator,
		type Attachment as ComposeAttachment
	} from './attachmentUpload';
	import type { Editor } from '@tiptap/core';

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

	$effect(() => {
		if (identIdx >= identityOptions.length) identIdx = 0;
	});
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

	const currentAddress = $derived(addresses.getByEmail(ident.email));
	const currentSignature = $derived(signatures.getForAddress(currentAddress?.id ?? null));

	$effect(() => {
		if (isDraftEdit) return;
		if (!editor) return;
		if (!currentAddress) return;
		if (seededSignature) return;
		applySignatureSeed(editor, currentAddress.id, currentSignature?.bodyHtml ?? '');
		seededSignature = true;
	});

	function pickIdentity(i: number) {
		identIdx = i;
		fromOpen = false;
		if (isDraftEdit || !editor) return;
		const addr = addresses.getByEmail(identityOptions[i]?.email ?? '');
		if (!addr) return;
		const sig = signatures.getForAddress(addr.id);
		if (!seededSignature) {
			applySignatureSeed(editor, addr.id, sig?.bodyHtml ?? '');
			seededSignature = true;
			return;
		}
		swapSignatureForAddress(editor, addr.id, sig?.bodyHtml ?? '');
	}

	let attachments = $state<ComposeAttachment[]>([]);
	let fileInput: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let attErr = $state<string | null>(null);
	const orchestrator = new UploadOrchestrator((a) => {
		attachments = attachments.map((x) => (x.id === a.id ? { ...a } : x));
	}, auth.accountId ?? '');

	const isDraftEdit = !!draftId;
	let savedDraftId = $state<string | null>(draftId);
	let draftStatus = $state<'idle' | 'saving' | 'saved'>(isDraftEdit ? 'saved' : 'idle');
	let hydrating = $state(isDraftEdit);
	let lastSavedJson = '';
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function chipsToRecipients(chips: RecipientChip[]) {
		return chips
			.filter((c) => c.email.trim())
			.map((c) => ({ name: c.name || undefined, address: c.email }));
	}

	function currentDoc(): DraftDoc {
		return {
			v: 1,
			from: { email: ident.email, name: ident.name },
			to: chipsToRecipients(to),
			cc: chipsToRecipients(cc),
			bcc: chipsToRecipients(bcc),
			subject,
			bodyHtml,
			bodyText,
			attachments: attachments
				.filter((a) => a.senderDescriptor)
				.map((a, i) => ({
					ordinal: i,
					objectKey: a.senderDescriptor!.objectKey,
					ciphertextSizeBytes: a.senderDescriptor!.ciphertextSizeBytes,
					ciphertextSha256: a.senderDescriptor!.ciphertextSha256,
					keyFingerprint: a.senderDescriptor!.keyFingerprint,
					filename: a.file.name,
					mime: a.file.type || 'application/octet-stream',
					size: a.file.size,
					disposition: a.disposition,
					contentId: a.contentId
				}))
		};
	}

	function isWorthSaving(doc: DraftDoc): boolean {
		return (
			doc.to.length > 0 ||
			doc.cc.length > 0 ||
			doc.bcc.length > 0 ||
			doc.subject.trim() !== '' ||
			doc.bodyText.trim() !== '' ||
			doc.attachments.length > 0
		);
	}

	function draftRowFromDoc(id: string, doc: DraftDoc): DraftRow {
		const now = new Date();
		const recips = [...doc.to, ...doc.cc, ...doc.bcc].map((r) => r.name || r.address);
		const summary =
			recips.length === 0
				? '(no recipients)'
				: recips.length <= 2
					? recips.join(', ')
					: `${recips.slice(0, 2).join(', ')} +${recips.length - 2}`;
		return {
			id,
			subject: doc.subject.trim() || '(no subject)',
			snippet: doc.bodyText.slice(0, 280),
			to: summary,
			updatedAt: now.toISOString(),
			epoch: now.getTime(),
			attachmentCount: doc.attachments.length,
			init: initialsFor(doc.subject || '', '')
		};
	}

	function uploadsInFlight(): boolean {
		return attachments.some(
			(a) => a.status === 'queued' || a.status === 'encrypting' || a.status === 'uploading'
		);
	}

	async function saveDraft(): Promise<void> {
		if (hydrating || status === 'sending') return;
		if (uploadsInFlight()) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		const doc = currentDoc();
		if (!savedDraftId && !isWorthSaving(doc)) return;
		const json = JSON.stringify(doc);
		if (json === lastSavedJson) return;
		const id = savedDraftId ?? crypto.randomUUID();
		savedDraftId = id;
		draftStatus = 'saving';
		try {
			const req = await buildDraftEnvelope(accountId, doc);
			await putDraft(id, req);
			lastSavedJson = json;
			draftStatus = 'saved';
			drafts.upsertLocal(draftRowFromDoc(id, doc));
		} catch {
			draftStatus = 'idle';
		}
	}

	function scheduleSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void saveDraft(), 1500);
	}

	function flushSave(): void {
		clearTimeout(saveTimer);
		void saveDraft();
	}

	function discardDraft(): void {
		clearTimeout(saveTimer);
		const id = savedDraftId;
		savedDraftId = null;
		if (id) {
			drafts.remove(id);
			void deleteDraft(id).catch(() => {});
		}
		onClose();
	}

	function closeKeepingDraft(): void {
		flushSave();
		onClose();
	}

	$effect(() => {
		void to;
		void cc;
		void bcc;
		void subject;
		void bodyHtml;
		void attachments.map((a) => `${a.id}:${a.status}:${a.senderDescriptor?.objectKey ?? ''}`).join('|');
		if (hydrating || status === 'sending') return;
		scheduleSave();
	});

	onMount(() => {
		void contacts.ensureLoaded();
		if (draftId) void hydrateDraft(draftId);
		return () => clearTimeout(saveTimer);
	});

	async function hydrateDraft(id: string): Promise<void> {
		const accountId = auth.accountId;
		if (!accountId) {
			hydrating = false;
			return;
		}
		try {
			const detail = await getDraft(id);
			const doc = await loadDraftDoc(accountId, detail);
			const idx = identityOptions.findIndex((o) => o.email === doc.from.email);
			if (idx >= 0) identIdx = idx;
			to = doc.to.map(recipientChip);
			cc = doc.cc.map(recipientChip);
			bcc = doc.bcc.map(recipientChip);
			if (cc.length) showCc = true;
			if (bcc.length) showBcc = true;
			subject = doc.subject;
			bodyHtml = doc.bodyHtml;
			bodyText = doc.bodyText;
			for (let i = 0; i < doc.attachments.length; i++) {
				const meta = doc.attachments[i];
				const ptr = detail.attachments[i]?.pointer;
				if (!ptr) continue;
				try {
					const file = await restoreAttachmentFile(accountId, ptr);
					const att: ComposeAttachment = {
						id: crypto.randomUUID(),
						file,
						status: 'queued',
						progress: 0,
						disposition: meta.disposition,
						contentId: meta.contentId
					};
					attachments = [...attachments, att];
					startUpload(att);
				} catch {
					attErr = `Could not restore attachment "${meta.filename}".`;
				}
			}
		} catch {
			err = new SendError('unknown', 'Could not open this draft.');
		} finally {
			hydrating = false;
			draftStatus = 'saved';
		}
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
		const incoming = Array.from(files);
		for (const file of incoming) {
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
		validCount > 0 && !hasInvalid && status !== 'sending' && attReady
	);
	const subjLine = $derived(subject.trim() || 'New message');

	const INLINE_CODES = new Set<SendError['code']>([
		'recipient_unknown',
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
			if (!err) closeKeepingDraft();
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

	async function performSend(acceptKeyChange: boolean, scheduledAt?: string | null) {
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
				await orchestrator.ensureRecipientCopies(attachments, recipientAddresses());
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
				{ acceptKeyChange }
			);
			status = 'idle';
			attempts = 0;
			pendingScheduledAt = null;
			clearTimeout(saveTimer);
			if (savedDraftId) {
				const id = savedDraftId;
				savedDraftId = null;
				drafts.remove(id);
				void deleteDraft(id).catch(() => {});
			}
			onSend(when ? { scheduledAt: when } : undefined);
		} catch (e) {
			status = 'idle';
			if (e instanceof SendError) {
				err = e;
				if (e.code === 'encrypt') attempts += 1;
				else attempts = 0;
			} else {
				err = new SendError('unknown', e instanceof Error ? e.message : 'Send failed');
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

	const runSend = () => performSend(false, null);
	const retrySend = () => performSend(false);
	const scheduleSend = (when: Date) => performSend(false, when.toISOString());
	const trustAndSend = () => performSend(true);
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
		await performSend(false);
	}

	$effect(() => {
		bodyEmpty = !bodyText.trim();
	});

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) closeKeepingDraft();
	}

	function insertLink() {
		if (!editor) return;
		const previous = (editor.getAttributes('link').href as string | undefined) ?? '';
		const url = window.prompt('Link URL', previous);
		editor.commands.focus();
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		const normalized = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
		editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
	}
</script>

<svelte:document onkeydown={handleKey} onmousedown={handleDocMouseDown} />

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
			title="Expand"
			onclick={(e) => {
				e.stopPropagation();
				min = false;
			}}><ChevronUp size={16} /></button
		>
		<button
			type="button"
			class="dock-b"
			title="Discard"
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
				<PenLine size={16} />New message
				<div class="ch-actions">
					<button type="button" class="chx" title="Minimize" onclick={() => (min = true)}>
						<Minus size={16} />
					</button>
					<button type="button" class="chx x" title="Close" onclick={closeKeepingDraft}>
						<X size={16} />
					</button>
				</div>
			</div>

			<div class="compose-scroll">
				<div class="from-row" bind:this={fromRef}>
					<span class="recip-label">From</span>
					<button
						type="button"
						class="from-trigger"
						class:open={fromOpen}
						onclick={() => (fromOpen = !fromOpen)}
					>
						<Avatar initials={ident.init} size={22} bg={ident.bg} fg={ident.fg} />
						<span class="ft-name">{ident.name}</span>
						<span class="ft-email">&lt;{ident.email}&gt;</span>
						<ChevronDown size={15} />
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
									onclick={() => {
										pickIdentity(i);
									}}
								>
									<Avatar initials={id.init} size={30} bg={id.bg} fg={id.fg} />
									<span class="fm-tx">
										<span class="fm-top">
											<b>{id.name}</b>
											<span class="fm-kind">{id.kind === 'Alias' ? 'Shared' : id.kind}</span>
										</span>
										<span class="fm-em">{id.email}</span>
										{#if id.org}<span class="fm-org">{id.org}</span>{/if}
									</span>
									{#if i === identIdx}<Check size={17} />{/if}
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
								<AtSign size={16} />Manage addresses
							</button>
						</div>
					{/if}
				</div>

				{#snippet ccBccSlot()}
					<div class="ccbcc">
						{#if !showCc}
							<button type="button" onclick={() => (showCc = true)}>Cc</button>
						{/if}
						{#if !showBcc}
							<button type="button" onclick={() => (showBcc = true)}>Bcc</button>
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
					<span class="recip-label">Subject</span>
					<input bind:value={subject} placeholder="Subject" />
				</div>

				<RichEditor
					bind:html={bodyHtml}
					bind:text={bodyText}
					bind:editor
					placeholder="Write your message…"
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
					<div class="att-drop">Drop to attach</div>
				{/if}
			</div>

			<input
				bind:this={fileInput}
				type="file"
				multiple
				class="att-hidden-input"
				onchange={onFileInputChange}
			/>

			<EditorToolbar {editor} />

			{#if warn && !canSend && status !== 'sending'}
				<div class="cwarn">
					<CircleAlert size={14} />
					{hasInvalid
						? 'One or more addresses are not valid.'
						: 'Add at least one recipient and a message body.'}
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

			<div class="compose-f">
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
							<span class="send-spin"></span>Sending…
						{:else}
							<Send size={16} />Send
						{/if}
					</button>
					<button
						type="button"
						class="send-caret"
						title="Send options"
						disabled={!canSend || status === 'sending'}
						onclick={() => {
							if (canSend && status !== 'sending') sendOpen = !sendOpen;
						}}
					>
						<ChevronUp size={15} />
					</button>
					{#if sendOpen}
						<div class="send-menu" role="menu">
							<button type="button" onclick={runSend}><Send size={16} />Send now</button>
							<button
								type="button"
								onclick={() => {
									sendOpen = false;
									scheduleOpen = true;
								}}><Clock size={16} />Schedule send</button
							>
						</div>
					{/if}
				</div>

				<button type="button" class="cf-ico" title="Attach files" onclick={pickFiles}>
					<Paperclip size={17} />
				</button>

				<button type="button" class="cf-ico" title="Insert link" onclick={insertLink}>
					<Link size={17} />
				</button>

				<span class="cf-enc" data-tone={encSummary.tone} title={encSummary.title}>
					{#if encSummary.tone === 'partial' || encSummary.tone === 'none'}
						<LockOpen size={16} />
					{:else}
						<Lock size={16} />
					{/if}
					<span class="cf-enc-t">{encSummary.label}</span>
				</span>

				<span class="csave"
					>{draftStatus === 'saving'
						? 'Saving…'
						: draftStatus === 'saved'
							? 'Draft saved'
							: 'Draft'}</span
				>
				<button type="button" class="cf-ico danger" title="Discard draft" onclick={discardDraft}>
					<Trash2 size={17} />
				</button>
			</div>
		</div>
	</div>

	{#if scheduleOpen}
		<SchedulePicker
			busy={status === 'sending'}
			onSchedule={scheduleSend}
			onClose={() => (scheduleOpen = false)}
		/>
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
			shared={err.payload.shared}
			onSendAnyway={trustAndSend}
			onCancel={clearErr}
		/>
	{:else if err && err.code === 'tofu'}
		<TofuModal
			recipient={modalRecip}
			onSendAnyway={trustAndSend}
			onCancel={clearErr}
		/>
	{/if}

	{#if err && err.code === 'external_key_change' && err.payload?.kind === 'external-key-change'}
		<TofuModal
			recipient={{ name: '', email: err.payload.address }}
			currentFingerprint={err.payload.currentFingerprint}
			onSendAnyway={acceptExternalAndSend}
			onCancel={clearErr}
		/>
	{/if}
{/if}
