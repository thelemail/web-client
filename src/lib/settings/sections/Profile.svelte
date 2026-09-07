<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import { platform } from '$platform';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Info from '@lucide/svelte/icons/info';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Avatar from '$lib/components/Avatar.svelte';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Toggle from '../Toggle.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import SignatureEditor from './SignatureEditor.svelte';
	import type { SignatureMode, SignatureDocImage } from '$lib/mail/signatureCrypto';
	import { initialsFor } from '$lib/mail/initials';
	import { addresses } from '$lib/stores/addresses.svelte';
	import { signatures } from '$lib/stores/signatures.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		updateMe,
		requestAvatarUploadUrl,
		commitAvatar,
		deleteAvatar
	} from '$lib/api/me';

	interface Props {
		email: string;
		dirty?: boolean;
		save?: () => Promise<void>;
		onEdit?: () => void;
	}

	let {
		email,
		dirty = $bindable(false),
		save = $bindable(async () => {}),
		onEdit
	}: Props = $props();

	const SAME_AS_SENDING_VALUE = '';
	const REPLY_SAME_LABEL = 'Same as sending identity';
	const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

	let displayName = $state(auth.fullName ?? '');
	let initialDisplayName = $state(auth.fullName ?? '');
	let displayNameDirty = $derived(displayName.trim() !== initialDisplayName.trim());

	let defaultReplyAddressId = $state<string>(auth.defaultReplyAddressId ?? SAME_AS_SENDING_VALUE);
	let initialDefaultReplyAddressId = $state<string>(auth.defaultReplyAddressId ?? SAME_AS_SENDING_VALUE);
	let defaultReplyDirty = $derived(defaultReplyAddressId !== initialDefaultReplyAddressId);

	$effect(() => {
		const next = auth.fullName ?? '';
		if (next !== initialDisplayName && !displayNameDirty) {
			displayName = next;
			initialDisplayName = next;
		}
	});

	$effect(() => {
		const next = auth.defaultReplyAddressId ?? SAME_AS_SENDING_VALUE;
		if (next !== initialDefaultReplyAddressId && !defaultReplyDirty) {
			defaultReplyAddressId = next;
			initialDefaultReplyAddressId = next;
		}
	});

	const identities = $derived(addresses.items);
	const primary = $derived(identities.find((a) => a.isPrimary) ?? identities[0] ?? null);
	const isWorkspaceOwner = $derived(workspaces.isOwner(auth.accountId));

	let sigForAddressId = $state<string | null>(null);
	$effect(() => {
		if (!sigForAddressId && primary) {
			sigForAddressId = primary.id;
		} else if (sigForAddressId && !identities.find((a) => a.id === sigForAddressId)) {
			sigForAddressId = primary?.id ?? null;
		}
	});

	const sigIdentity = $derived(
		sigForAddressId ? identities.find((a) => a.id === sigForAddressId) ?? primary : primary
	);

	let signatureDirty = $state(false);
	let signatureMode = $state<SignatureMode>('rich');
	let signatureSource = $state('');
	let signatureBodyHtml = $state('');
	let signatureEnabled = $state(true);
	let signatureAppendOnReply = $state(true);
	let initialSignatureBodyHtml = $state('');
	let initialSignatureSource = $state('');
	let initialSignatureMode = $state<SignatureMode>('rich');
	let initialSignatureEnabled = $state(true);
	let initialSignatureAppendOnReply = $state(true);

	const signatureLocked = $derived(
		signatures.locked || (signatures.getForAddress(sigForAddressId)?.sealed ?? false)
	);

	$effect(() => {
		if (!sigForAddressId) {
			initialSignatureBodyHtml = '';
			initialSignatureSource = '';
			initialSignatureMode = 'rich';
			initialSignatureEnabled = true;
			initialSignatureAppendOnReply = true;
			signatureBodyHtml = '';
			signatureSource = '';
			signatureMode = 'rich';
			signatureEnabled = true;
			signatureAppendOnReply = true;
			signatureDirty = false;
			return;
		}
		if (signatureDirty) return;
		const existing = signatures.getForAddress(sigForAddressId);
		const doc = existing?.doc;
		const html = doc?.bodyHtml ?? '';
		const src = doc?.source ?? html;
		const docMode = doc?.mode ?? 'rich';
		const enabled = existing?.enabled ?? true;
		const append = existing?.appendOnReply ?? true;
		initialSignatureBodyHtml = html;
		initialSignatureSource = src;
		initialSignatureMode = docMode;
		initialSignatureEnabled = enabled;
		initialSignatureAppendOnReply = append;
		signatureBodyHtml = html;
		signatureSource = src;
		signatureMode = docMode;
		signatureEnabled = enabled;
		signatureAppendOnReply = append;
	});

	const ownIdentities = $derived(addresses.personal);

	const replyOptions = $derived([
		{ id: SAME_AS_SENDING_VALUE, label: REPLY_SAME_LABEL },
		...ownIdentities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	]);

	const sendingOptions = $derived(
		ownIdentities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	);

	const signatureOptions = $derived(
		identities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	);

	const replyValueLabel = $derived(
		replyOptions.find((o) => o.id === defaultReplyAddressId)?.label ?? REPLY_SAME_LABEL
	);
	const sendingValueLabel = $derived(
		sendingOptions.find((o) => o.id === primary?.id)?.label ?? sendingOptions[0]?.label ?? ''
	);

	function identityLabel(name: string | null | undefined, addr: string): string {
		if (name && name.trim()) return `${name.trim()} — ${addr}`;
		return addr;
	}

	$effect(() => {
		dirty = displayNameDirty || defaultReplyDirty || signatureDirty;
	});

	async function flushSave(): Promise<void> {
		if (displayNameDirty || defaultReplyDirty) {
			const payload: Parameters<typeof updateMe>[0] = {};
			if (displayNameDirty) payload.fullName = displayName.trim();
			if (defaultReplyDirty) {
				if (defaultReplyAddressId === SAME_AS_SENDING_VALUE) {
					payload.clearDefaultReply = true;
					payload.defaultReplyAddressId = null;
				} else {
					payload.defaultReplyAddressId = defaultReplyAddressId;
				}
			}
			const updated = await updateMe(payload);
			auth.applyMe(updated);
			initialDisplayName = updated.fullName;
			initialDefaultReplyAddressId = updated.defaultReplyAddressId ?? SAME_AS_SENDING_VALUE;
		}
		if (signatureDirty && sigForAddressId) {
			if (signatureLocked) throw new Error('Unlock your vault before saving a signature.');
			if (!signatureBodyHtml.trim() && signatures.getForAddress(sigForAddressId)) {
				await signatures.remove(sigForAddressId);
			} else if (signatureBodyHtml.trim()) {
				await signatures.save(
					sigForAddressId,
					{
						v: 1,
						mode: signatureMode,
						source: signatureSource,
						bodyHtml: signatureBodyHtml,
						images: collectSignatureImages(signatureBodyHtml)
					},
					{ enabled: signatureEnabled, appendOnReply: signatureAppendOnReply }
				);
			}
			initialSignatureBodyHtml = signatureBodyHtml;
			initialSignatureSource = signatureSource;
			initialSignatureMode = signatureMode;
			initialSignatureEnabled = signatureEnabled;
			initialSignatureAppendOnReply = signatureAppendOnReply;
			signatureDirty = false;
		}
	}

	$effect(() => {
		save = flushSave;
	});

	async function onSendingChange(addrId: string) {
		const target = addresses.getById(addrId);
		if (!target || target.isPrimary || target.shared) return;
		try {
			await addresses.setPrimary(addrId);
		} catch (err) {
			console.warn('set primary failed', err);
		}
	}

	async function onReplyChange(label: string) {
		const option = replyOptions.find((o) => o.label === label);
		if (!option) return;
		defaultReplyAddressId = option.id;
		onEdit?.();
	}

	async function onSendingLabelChange(label: string) {
		const option = sendingOptions.find((o) => o.label === label);
		if (!option) return;
		await onSendingChange(option.id);
	}

	let avatarBusy = $state(false);
	let avatarError = $state<string | null>(null);
	let fileInputRef: HTMLInputElement | undefined = $state();

	function triggerPick() {
		avatarError = null;
		fileInputRef?.click();
	}

	async function onAvatarPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
			avatarError = 'Use a JPG, PNG, or WebP image.';
			return;
		}
		if (file.size > MAX_AVATAR_BYTES) {
			avatarError = `Maximum size is ${(MAX_AVATAR_BYTES / 1024 / 1024).toFixed(0)} MB.`;
			return;
		}
		avatarBusy = true;
		try {
			const grant = await requestAvatarUploadUrl();
			const put = await platform.blobPut(grant.uploadUrl, file, file.type);
			if (!put.ok) {
				throw new Error(`upload failed (${put.status})`);
			}
			const me = await commitAvatar(grant.objectKey);
			auth.applyMe(me);
		} catch (err) {
			avatarError = err instanceof Error ? err.message : 'Could not upload avatar';
		} finally {
			avatarBusy = false;
		}
	}

	async function onAvatarClear() {
		avatarError = null;
		avatarBusy = true;
		try {
			const me = await deleteAvatar();
			auth.applyMe(me);
		} catch (err) {
			avatarError = err instanceof Error ? err.message : 'Could not remove avatar';
		} finally {
			avatarBusy = false;
		}
	}

	const initials = $derived(initialsFor(displayName || auth.fullName, email));
	const ownerBadge = $derived(isWorkspaceOwner);

	function collectSignatureImages(html: string): SignatureDocImage[] {
		if (!html || typeof DOMParser === 'undefined') return [];
		const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
		const keys = new Set<string>();
		for (const img of doc.querySelectorAll('img[data-thelemail-sig-image]')) {
			const key = img.getAttribute('data-thelemail-sig-image');
			if (key) keys.add(key);
		}
		return [...keys].map((objectKey) => ({ objectKey, contentType: 'application/octet-stream' }));
	}

	function recomputeSignatureDirty() {
		signatureDirty =
			signatureBodyHtml !== initialSignatureBodyHtml ||
			signatureSource !== initialSignatureSource ||
			signatureMode !== initialSignatureMode ||
			signatureEnabled !== initialSignatureEnabled ||
			signatureAppendOnReply !== initialSignatureAppendOnReply;
		onEdit?.();
	}

	function onSignatureChange(payload: {
		mode: SignatureMode;
		source: string;
		bodyHtml: string;
	}) {
		signatureMode = payload.mode;
		signatureSource = payload.source;
		signatureBodyHtml = payload.bodyHtml;
		recomputeSignatureDirty();
	}
</script>

<SecHead desc="Your name and signature, and the address you send from by default. Your domain, your identity." />

<div class="scard">
	<div class="profile">
		<div class="pf-avwrap">
			<Avatar
				{initials}
				src={auth.avatarUrl}
				fit="cover"
				size={64}
				bg="var(--pine-700)"
				fg="#EEF2EA"
				class="pf-av"
			/>
			<button
				type="button"
				class="pf-avedit"
				title="Change photo"
				onclick={triggerPick}
				disabled={avatarBusy}
			>
				{#if avatarBusy}
					<Loader2 size={14} class="spin" />
				{:else}
					<Camera size={14} />
				{/if}
			</button>
			{#if auth.avatarUrl}
				<button
					type="button"
					class="pf-avclear"
					title="Remove avatar"
					onclick={onAvatarClear}
					disabled={avatarBusy}
				>
					<Trash2 size={12} />
				</button>
			{/if}
			<input
				bind:this={fileInputRef}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				onchange={onAvatarPicked}
				class="hidden-input"
			/>
		</div>
		<div class="pf-info">
			<div class="pf-name">{displayName || email}</div>
			<div class="pf-mail">{email}</div>
			<div class="pf-tags">
				{#if ownerBadge}
					<Badge kind="pine" dot>Owner</Badge>
				{/if}
				<span class="badge b-ok"><ShieldCheck size={12} />Verified domain</span>
			</div>
			{#if avatarError}
				<div class="pf-error">{avatarError}</div>
			{/if}
		</div>
	</div>
	<Row t="Display name" d="Shown on mail you send and across the archive.">
		<input
			class="tin w-mid"
			value={displayName}
			oninput={(e) => {
				displayName = (e.currentTarget as HTMLInputElement).value;
				onEdit?.();
			}}
		/>
	</Row>
	<Row t="Default sending identity" d="The “From” address used when you start a new message.">
		{#if sendingOptions.length === 0}
			<span class="muted">Add an address to choose a sending identity.</span>
		{:else}
			<Select
				value={sendingValueLabel}
				options={sendingOptions.map((o) => o.label)}
				onChange={onSendingLabelChange}
			/>
		{/if}
	</Row>
	<Row t="Default reply address" d="Where replies are directed if it differs from the sending identity.">
		<Select
			value={replyValueLabel}
			options={replyOptions.map((o) => o.label)}
			onChange={onReplyChange}
		/>
	</Row>
</div>

<div class="scard">
	<CardHead icon={PenLine} title="Signature">
		{#snippet right()}
			<span class="sig-picker">
				<span class="sig-picker-lbl">For</span>
				{#if signatureOptions.length > 0}
					<Select
						narrow
						value={sigIdentity ? identityLabel(sigIdentity.name, sigIdentity.email) : ''}
						options={signatureOptions.map((o) => o.label)}
						onChange={(label) => {
							const opt = signatureOptions.find((o) => o.label === label);
							if (opt) sigForAddressId = opt.id;
						}}
						ariaLabel="Signature identity"
					/>
				{/if}
			</span>
		{/snippet}
	</CardHead>
	<div class="sig-wrap">
		{#if sigIdentity}
			<div class="sig-idnote">
				<UserRound size={13} />Editing the signature for <b>{sigIdentity.name || sigIdentity.email}</b>
				{#if sigIdentity.shared}<Badge kind="pine">Shared</Badge>{/if}
			</div>
			<SignatureEditor
				addressId={sigIdentity.id}
				mode={signatureMode}
				source={signatureSource}
				bodyHtml={signatureBodyHtml}
				locked={signatureLocked}
				onChange={onSignatureChange}
			/>
			<div class="sig-hint">
				{#if sigIdentity.shared}
					<Info size={13} />Everyone who writes from <b>{sigIdentity.email}</b> sends this signature.
				{:else}
					<Info size={13} />Each address keeps its own signature. This one is sent when you write from
					<b>{sigIdentity.email}</b>.
				{/if}
			</div>
			<Row
				t="Include by default"
				d="New messages start with this signature. Turn it off to add it only when you want it."
			>
				<Toggle
					on={signatureEnabled}
					disabled={signatureLocked}
					onChange={(v) => {
						signatureEnabled = v;
						recomputeSignatureDirty();
					}}
				/>
			</Row>
			<Row
				t="Append on replies and forwards"
				d="When off, the signature is only added to new messages — not replies."
			>
				<Toggle
					on={signatureAppendOnReply}
					disabled={signatureLocked || !signatureEnabled}
					onChange={(v) => {
						signatureAppendOnReply = v;
						recomputeSignatureDirty();
					}}
				/>
			</Row>
		{:else}
			<div class="muted">Add an address before you can write a signature.</div>
		{/if}
	</div>
</div>

<style>
	.hidden-input {
		display: none;
	}
	.pf-avwrap {
		position: relative;
		display: inline-flex;
	}
	.pf-avclear {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--paper, #f6efde);
		border: 1px solid var(--paper-200, #d6cbb6);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.pf-error {
		color: var(--warn, #b25030);
		margin-top: 6px;
		font-size: 12.5px;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.muted {
		color: var(--ink-faint, #9a8f7d);
	}
</style>
