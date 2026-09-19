<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Camera from '@lucide/svelte/icons/camera';
	import { platform } from '$platform';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Info from '@lucide/svelte/icons/info';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Avatar from '$core/components/Avatar.svelte';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Toggle from '../Toggle.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import SignatureEditor from './SignatureEditor.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import type { SignatureMode, SignatureDocImage } from '$core/mail/signatureCrypto';
	import { hostSignatureImages } from '$core/mail/signatureImages';
	import { hasRenderableHtml } from '$core/mail/signatureRegion';
	import { initialsFor } from '$core/mail/initials';
	import { addresses } from '$core/stores/addresses.svelte';
	import { signatures } from '$core/stores/signatures.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import {
		updateMe,
		requestAvatarUploadUrl,
		commitAvatar,
		deleteAvatar
	} from '$core/api/me';

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
	let signatureHydratedFor = $state<string | null>(null);
	let signatureHydratedRev = $state<string>('');

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
			signatureHydratedFor = null;
			signatureHydratedRev = '';
			return;
		}
		const existing = signatures.getForAddress(sigForAddressId);
		const rev = existing?.updatedAt ?? '';
		const addressChanged = signatureHydratedFor !== sigForAddressId;
		if (!addressChanged && (signatureDirty || rev === signatureHydratedRev)) return;
		signatureHydratedFor = sigForAddressId;
		signatureHydratedRev = rev;
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
		{ id: SAME_AS_SENDING_VALUE, label: m.settings_profile_reply_same() },
		...ownIdentities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	]);

	const sendingOptions = $derived(
		ownIdentities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	);

	const signatureOptions = $derived(
		identities.map((a) => ({ id: a.id, label: identityLabel(a.name, a.email) }))
	);

	const replyValueLabel = $derived(
		replyOptions.find((o) => o.id === defaultReplyAddressId)?.label ?? m.settings_profile_reply_same()
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
			if (signatureLocked) throw new Error(m.settings_profile_signature_locked_save());
			if (signatureBodyHtml.trim()) {
				const hostedResult = await hostSignatureImages(sigForAddressId, signatureBodyHtml);
				if (hostedResult.html !== signatureBodyHtml) {
					signatureBodyHtml = hostedResult.html;
					if (signatureMode === 'html') signatureSource = hostedResult.html;
				}
			}
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
			avatarError = m.settings_profile_avatar_type();
			return;
		}
		if (file.size > MAX_AVATAR_BYTES) {
			avatarError = m.settings_signature_image_size({ size: (MAX_AVATAR_BYTES / 1024 / 1024).toFixed(0) });
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
			avatarError = err instanceof Error ? err.message : m.settings_profile_avatar_upload_failed();
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
			avatarError = err instanceof Error ? err.message : m.settings_profile_avatar_remove_failed();
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
		const body = hasRenderableHtml(payload.bodyHtml) ? payload.bodyHtml : '';
		signatureMode = payload.mode;
		signatureSource = payload.mode === 'rich' && !body ? '' : payload.source;
		signatureBodyHtml = body;
		recomputeSignatureDirty();
	}
</script>

<SecHead desc={m.settings_profile_desc()} />

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
				title={m.settings_profile_change_photo()}
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
					title={m.settings_profile_remove_avatar()}
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
					<Badge kind="pine" dot>{m.settings_profile_owner()}</Badge>
				{/if}
				<span class="badge b-ok"><ShieldCheck size={12} />{m.settings_profile_verified_domain()}</span>
			</div>
			{#if avatarError}
				<div class="pf-error">{avatarError}</div>
			{/if}
		</div>
	</div>
	<Row t={m.settings_profile_display_name()} d={m.settings_profile_display_name_desc()}>
		<input
			class="tin w-mid"
			value={displayName}
			oninput={(e) => {
				displayName = (e.currentTarget as HTMLInputElement).value;
				onEdit?.();
			}}
		/>
	</Row>
	<Row t={m.settings_profile_sending_identity()} d={m.settings_profile_sending_identity_desc()}>
		{#if sendingOptions.length === 0}
			<span class="muted">{m.settings_profile_sending_identity_empty()}</span>
		{:else}
			<Select
				value={sendingValueLabel}
				options={sendingOptions.map((o) => o.label)}
				onChange={onSendingLabelChange}
			/>
		{/if}
	</Row>
	<Row t={m.settings_profile_reply_address()} d={m.settings_profile_reply_address_desc()}>
		<Select
			value={replyValueLabel}
			options={replyOptions.map((o) => o.label)}
			onChange={onReplyChange}
		/>
	</Row>
</div>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<div class="scard">
	<CardHead icon={PenLine} title={m.settings_profile_signature()}>
		{#snippet right()}
			<span class="sig-picker">
				<span class="sig-picker-lbl">{m.settings_profile_signature_for()}</span>
				{#if signatureOptions.length > 0}
					<Select
						narrow
						value={sigIdentity ? identityLabel(sigIdentity.name, sigIdentity.email) : ''}
						options={signatureOptions.map((o) => o.label)}
						onChange={(label) => {
							const opt = signatureOptions.find((o) => o.label === label);
							if (opt) sigForAddressId = opt.id;
						}}
						ariaLabel={m.settings_profile_signature_identity()}
					/>
				{/if}
			</span>
		{/snippet}
	</CardHead>
	<div class="sig-wrap">
		{#if sigIdentity}
			<div class="sig-idnote">
				<UserRound size={13} /><Rich
					text={m.settings_profile_signature_editing({ name: sigIdentity.name || sigIdentity.email })}
					tags={{ b: bold }}
				/>
				{#if sigIdentity.shared}<Badge kind="pine">{m.settings_profile_shared()}</Badge>{/if}
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
					<Info size={13} /><Rich
						text={m.settings_profile_signature_hint_shared({ email: sigIdentity.email })}
						tags={{ b: bold }}
					/>
				{:else}
					<Info size={13} /><Rich
						text={m.settings_profile_signature_hint({ email: sigIdentity.email })}
						tags={{ b: bold }}
					/>
				{/if}
			</div>
			<Row
				t={m.settings_profile_signature_default()}
				d={m.settings_profile_signature_default_desc()}
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
				t={m.settings_profile_signature_replies()}
				d={m.settings_profile_signature_replies_desc()}
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
			<div class="muted">{m.settings_profile_signature_empty()}</div>
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
