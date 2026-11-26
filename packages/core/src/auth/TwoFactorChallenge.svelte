<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faChevronRight,
		faLifeRing,
		faMobile,
		faUsbDrive
	} from '@fortawesome/pro-regular-svg-icons';
	import type { TwoFactorMethod } from '$core/api/types';
	import { BACKUP_CODE_MAX_LENGTH, BACKUP_CODE_MIN_LENGTH, BACKUP_CODE_PLACEHOLDER } from '$core/auth/backup-codes';
	import { webauthnSupported } from '$core/auth/webauthn';
	import CodeCells from '$core/auth/form/CodeCells.svelte';
	import TextField from '$core/auth/form/TextField.svelte';
	import Status from '$core/auth/form/Status.svelte';
	import { unfold } from '$core/auth/form/unfold';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		email: string;
		methods: TwoFactorMethod[];
		busy: boolean;
		sealed?: boolean;
		error: string | null;
		keyNotice?: string | null;
		lede?: Snippet;
		top?: Snippet;
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
		sealed = false,
		error,
		keyNotice = null,
		lede,
		top,
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
{#snippet retry(t: string)}<button type="button" class="af-link" onclick={retryKey}>{t}</button>{/snippet}
{#snippet addr(t: string)}<span class="mono">{t}</span>{/snippet}

{#if view === 'switch'}
	<div class="card-surface">
		{@render top?.()}
		<div class="card-head">
			<h1>{m.auth_2fa_switch_title()}</h1>
			<p>{m.auth_2fa_switch_lede()}</p>
		</div>
		<div class="af-options">
			{#each available.filter((id) => id !== method) as id (id)}
				<button type="button" class="af-option" onclick={() => switchTo(id)}>
					<span class="ic">
						{#if id === 'app'}<Icon icon={faMobile} size={17} />
						{:else if id === 'key'}<Icon icon={faUsbDrive} size={17} />
						{:else}<Icon icon={faLifeRing} size={17} />{/if}
					</span>
					<span class="tx"><b>{META[id].label()}</b><span>{META[id].pick()}</span></span>
					<span class="chev"><Icon icon={faChevronRight} size={16} /></span>
				</button>
			{/each}
		</div>
		<p class="af-row"><button type="button" class="af-link muted" onclick={() => (view = 'challenge')}>{m.common_back()}</button></p>
	</div>
{:else}
	<form
		class="card-surface"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			if (method === 'app') verifyCode();
			else if (method === 'backup') verifyBackup();
		}}
	>
		{@render top?.()}
		<div class="card-head">
			<h1>{m.auth_2fa_title()}</h1>
			<p>
				{#if method === 'app'}<Rich text={m.auth_2fa_code_hint({ email })} tags={{ addr }} />
				{:else if method === 'backup'}{m.auth_2fa_backup_hint()}
				{:else}<Rich text={m.auth_2fa_key_lede({ email })} tags={{ addr }} />{/if}
			</p>
		</div>
		{#if lede}<p class="af-note" transition:unfold>{@render lede()}</p>{/if}
		{#if method === 'app'}
			<CodeCells
				id="twofa-code"
				bind:value={code}
				label={m.auth_s_2fa_code_label()}
				invalid={showBad}
				describedby="twofa-msg"
				disabled={busy}
				focus
				onedit={() => (editedSinceError = true)}
				onenter={verifyCode}
			/>
			{#if sealed}
				<Status tone="ok" reserve>{m.auth_login_signed_in()}</Status>
			{:else}
				<Status id="twofa-msg" tone={showBad ? 'bad' : 'hint'} reserve>
					{showBad ? m.auth_2fa_code_mismatch() : m.auth_2fa_code_refresh()}
				</Status>
			{/if}
			<Button type="submit" variant="primary" size="lg" block disabled={code.length < 6 || sealed} busy={busy && !sealed} busyLabel={m.auth_2fa_checking()}>
				{m.auth_2fa_verify_code()}
			</Button>
		{:else if method === 'key'}
			{#if sealed}
				<Status tone="ok" reserve>{m.auth_login_signed_in()}</Status>
			{:else}
				<Status id="twofa-msg" tone={busy ? 'busy' : showBad ? 'bad' : 'hint'} reserve>
					{#if busy}
						<Rich text={m.auth_2fa_key_busy()} tags={{ b: bold }} />
					{:else if showBad}
						<Rich text={m.auth_2fa_key_failed()} tags={{ b: bold, retry }} />
					{:else if keyNotice}
						<span role="alert"><Rich text={m.auth_2fa_key_notice({ notice: keyNotice })} tags={{ retry }} /></span>
					{:else}
						<Rich text={m.auth_2fa_key_waiting()} tags={{ b: bold, retry }} />
					{/if}
				</Status>
			{/if}
			<Button type="button" variant="primary" size="lg" block disabled={sealed} busy={busy && !sealed} busyLabel={m.auth_2fa_checking()} onclick={retryKey}>
				{m.auth_2fa_key_start()}
			</Button>
		{:else}
			<TextField
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
			/>
			{#if sealed}
				<Status tone="ok" reserve>{m.auth_login_signed_in()}</Status>
			{:else}
				<Status id="twofa-msg" tone={showBad ? 'bad' : 'hint'} reserve>{showBad ? m.auth_2fa_backup_invalid() : ''}</Status>
			{/if}
			<Button type="submit" variant="primary" size="lg" block disabled={bcode.trim().length < BACKUP_CODE_MIN_LENGTH || sealed} busy={busy && !sealed} busyLabel={m.auth_2fa_checking()}>
				{m.auth_2fa_use_backup()}
			</Button>
		{/if}
		<p class="af-row">
			{#if available.length > 1}
				<button type="button" class="af-link" disabled={busy} onclick={() => (view = 'switch')}>{m.auth_2fa_try_another()}</button>
				<span aria-hidden="true">·</span>
			{/if}
			<button type="button" class="af-link muted" disabled={busy} onclick={onBack}>{backText}</button>
		</p>
	</form>
{/if}
