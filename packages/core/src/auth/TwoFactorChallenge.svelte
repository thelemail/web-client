<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Usb from '@lucide/svelte/icons/usb';
	import type { TwoFactorMethod } from '$core/api/types';
	import { BACKUP_CODE_MAX_LENGTH, BACKUP_CODE_MIN_LENGTH, BACKUP_CODE_PLACEHOLDER } from '$core/auth/backup-codes';
	import { webauthnSupported } from '$core/auth/webauthn';
	import Blank from '$core/auth/sentence/Blank.svelte';
	import Clause from '$core/auth/sentence/Clause.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		email: string;
		methods: TwoFactorMethod[];
		busy: boolean;
		error: string | null;
		keyNotice?: string | null;
		lede?: Snippet;
		top?: Snippet;
		before?: Snippet;
		backLabel?: string;
		onTotp: (code: string) => void;
		onBackupCode: (code: string) => void;
		onWebauthn: () => void;
		onBack: () => void;
	}

	let {
		email,
		methods,
		busy,
		error,
		keyNotice = null,
		lede,
		top,
		before,
		backLabel,
		onTotp,
		onBackupCode,
		onWebauthn,
		onBack
	}: Props = $props();

	type MethodId = 'app' | 'key' | 'backup';

	const META: Record<MethodId, { label: () => string; pick: () => string }> = {
		app: { label: () => m.auth_2fa_method_app(), pick: () => m.auth_2fa_method_app_pick() },
		key: { label: () => m.auth_2fa_method_key(), pick: () => m.auth_2fa_method_key_pick() },
		backup: { label: () => m.auth_2fa_method_backup(), pick: () => m.auth_2fa_method_backup_pick() }
	};

	const backText = $derived(backLabel ?? m.auth_2fa_back_to_sign_in());

	const available = $derived.by<MethodId[]>(() => {
		const out: MethodId[] = [];
		if (methods.includes('webauthn') && webauthnSupported()) out.push('key');
		if (methods.includes('totp')) out.push('app');
		if (methods.includes('backupCode')) out.push('backup');
		return out.length > 0 ? out : ['backup'];
	});

	let method = $derived<MethodId>(available[0]);
	let view = $state<'challenge' | 'switch'>('challenge');
	let code = $state('');
	let bcode = $state('');
	let editedSinceError = $state(false);
	let keyAttempted = $state(false);

	const showBad = $derived(error !== null && !editedSinceError);

	$effect(() => {
		if (error !== null) editedSinceError = false;
	});

	$effect(() => {
		if (method === 'key' && view === 'challenge' && !busy && !keyAttempted) {
			keyAttempted = true;
			onWebauthn();
		}
	});

	function switchTo(id: MethodId) {
		method = id;
		view = 'challenge';
		code = '';
		bcode = '';
		editedSinceError = true;
		keyAttempted = false;
	}

	function verifyCode() {
		if (code.length < 6 || busy) return;
		onTotp(code);
	}

	function verifyBackup() {
		if (bcode.trim().length < BACKUP_CODE_MIN_LENGTH || busy) return;
		onBackupCode(bcode.trim());
	}

	function digitsOnly(raw: string): string {
		editedSinceError = true;
		return raw.replace(/\D/g, '').slice(0, 6);
	}

	function backupCase(raw: string): string {
		editedSinceError = true;
		return raw.toUpperCase();
	}

	function retryKey() {
		if (busy) return;
		editedSinceError = true;
		onWebauthn();
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet retry(t: string)}<button type="button" class="sp-link" onclick={retryKey}>{t}</button>{/snippet}
{#snippet addr(t: string)}<span class="mono">{t}</span>{/snippet}
{#snippet codeSlot(_: string)}<Blank
		id="twofa-code"
		bind:value={code}
		label={m.auth_s_2fa_code_label()}
		placeholder="000000"
		mono
		inputmode="numeric"
		autocomplete="one-time-code"
		maxlength={6}
		invalid={showBad}
		describedby="twofa-msg"
		disabled={busy}
		focus
		normalize={digitsOnly}
		onenter={verifyCode}
	/>{/snippet}
{#snippet backupSlot(_: string)}<Blank
		id="twofa-backup"
		bind:value={bcode}
		label={m.auth_2fa_method_backup()}
		placeholder={BACKUP_CODE_PLACEHOLDER}
		mono
		maxlength={BACKUP_CODE_MAX_LENGTH}
		invalid={showBad}
		describedby="twofa-msg"
		disabled={busy}
		focus
		normalize={backupCase}
		onenter={verifyBackup}
	/>{/snippet}

<div class="sp">
	{@render top?.()}
	{#if view === 'switch'}
		<p class="sent sm">{m.auth_2fa_switch_title()}.</p>
		<div class="sp-under">
			<p class="sp-msg">{m.auth_2fa_switch_lede()}</p>
			<div class="altlist">
				{#each available.filter((id) => id !== method) as id (id)}
					<button type="button" class="altopt" onclick={() => switchTo(id)}>
						<span class="alt-ic">
							{#if id === 'app'}<Smartphone size={17} strokeWidth={1.75} />
							{:else if id === 'key'}<Usb size={17} strokeWidth={1.75} />
							{:else}<LifeBuoy size={17} strokeWidth={1.75} />{/if}
						</span>
						<span class="alt-tx"><b>{META[id].label()}</b><span>{META[id].pick()}</span></span>
						<span class="alt-chev"><ChevronRight size={16} strokeWidth={1.75} /></span>
					</button>
				{/each}
			</div>
			<div class="sp-acts">
				<button type="button" class="sp-quiet" onclick={() => (view = 'challenge')}>{m.common_back()}</button>
			</div>
		</div>
	{:else}
		<p class="sent">
			{#if before}{@render before()}{' '}{/if}{#if method === 'app'}<Clause
					text={m.auth_s_2fa_code()}
					slots={{ code: codeSlot }}
				/>{:else if method === 'backup'}<Clause text={m.auth_s_2fa_backup()} slots={{ code: backupSlot }} />{:else}<Clause
					text={m.auth_s_2fa_key()}
				/>{/if}
		</p>
		<div class="sp-under">
			{#if lede}<p class="sp-msg">{@render lede()}</p>{/if}
			{#if method === 'app'}
				{#if showBad}
					<p class="sp-msg bad" role="alert" id="twofa-msg">
						<CircleAlert size={14} strokeWidth={1.75} /><span>{m.auth_2fa_code_mismatch()}</span>
					</p>
				{:else}
					<p class="sp-msg" id="twofa-msg">
						<span><Rich text={m.auth_2fa_code_hint({ email })} tags={{ addr }} /></span>
					</p>
				{/if}
				<div class="sp-acts">
					<Button variant="primary" size="lg" disabled={code.length < 6 || busy} onclick={verifyCode}>
						{#if busy}<span class="spinner"></span>{m.auth_2fa_checking()}{:else}{m.auth_2fa_verify_code()}{/if}
					</Button>
					{#if available.length > 1}
						<button type="button" class="sp-quiet" disabled={busy} onclick={() => (view = 'switch')}>{m.auth_2fa_try_another()}</button>
					{/if}
					<button type="button" class="sp-quiet" disabled={busy} onclick={onBack}>{backText}</button>
				</div>
			{:else if method === 'key'}
				<p class="sp-msg" id="twofa-msg">
					{#if busy}
						<span class="spinner"></span><span><Rich text={m.auth_2fa_key_busy()} tags={{ b: bold }} /></span>
					{:else if showBad}
						<span role="alert"><Rich text={m.auth_2fa_key_failed()} tags={{ b: bold, retry }} /></span>
					{:else if keyNotice}
						<span role="alert"><Rich text={m.auth_2fa_key_notice({ notice: keyNotice })} tags={{ retry }} /></span>
					{:else}
						<span><Rich text={m.auth_2fa_key_waiting()} tags={{ b: bold, retry }} /></span>
					{/if}
				</p>
				<div class="sp-acts">
					{#if available.length > 1}
						<button type="button" class="sp-quiet" disabled={busy} onclick={() => (view = 'switch')}>{m.auth_2fa_try_another()}</button>
					{/if}
					<button type="button" class="sp-quiet" disabled={busy} onclick={onBack}>{backText}</button>
				</div>
			{:else}
				{#if showBad}
					<p class="sp-msg bad" role="alert" id="twofa-msg">
						<CircleAlert size={14} strokeWidth={1.75} /><span>{m.auth_2fa_backup_invalid()}</span>
					</p>
				{:else}
					<p class="sp-msg" id="twofa-msg">{m.auth_2fa_backup_hint()}</p>
				{/if}
				<div class="sp-acts">
					<Button
						variant="primary"
						size="lg"
						disabled={bcode.trim().length < BACKUP_CODE_MIN_LENGTH || busy}
						onclick={verifyBackup}
					>
						{#if busy}<span class="spinner"></span>{m.auth_2fa_checking()}{:else}{m.auth_2fa_use_backup()}{/if}
					</Button>
					{#if available.length > 1}
						<button type="button" class="sp-quiet" disabled={busy} onclick={() => (view = 'switch')}>{m.auth_2fa_try_another()}</button>
					{/if}
					<button type="button" class="sp-quiet" disabled={busy} onclick={onBack}>{backText}</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
