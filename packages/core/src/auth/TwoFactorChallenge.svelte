<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Usb from '@lucide/svelte/icons/usb';
	import type { TwoFactorMethod } from '$core/api/types';
	import { webauthnSupported } from '$core/auth/webauthn';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		email: string;
		methods: TwoFactorMethod[];
		busy: boolean;
		error: string | null;
		eyebrow?: string;
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
		error,
		eyebrow,
		lede,
		top,
		backLabel,
		onTotp,
		onBackupCode,
		onWebauthn,
		onBack
	}: Props = $props();

	type MethodId = 'app' | 'key' | 'backup';

	const META: Record<MethodId, { label: () => string; pick: () => string; back: () => string }> = {
		app: {
			label: () => m.auth_2fa_method_app(),
			pick: () => m.auth_2fa_method_app_pick(),
			back: () => m.auth_2fa_back_to_app()
		},
		key: {
			label: () => m.auth_2fa_method_key(),
			pick: () => m.auth_2fa_method_key_pick(),
			back: () => m.auth_2fa_back_to_key()
		},
		backup: {
			label: () => m.auth_2fa_method_backup(),
			pick: () => m.auth_2fa_method_backup_pick(),
			back: () => m.auth_2fa_back_to_backup()
		}
	};

	const eyebrowText = $derived(eyebrow ?? m.auth_2fa_eyebrow());
	const backText = $derived(backLabel ?? m.auth_2fa_back_to_sign_in());

	const available = $derived.by<MethodId[]>(() => {
		const out: MethodId[] = [];
		if (methods.includes('totp')) out.push('app');
		if (methods.includes('webauthn') && webauthnSupported()) out.push('key');
		if (methods.includes('backupCode')) out.push('backup');
		return out.length > 0 ? out : ['backup'];
	});

	let method = $derived<MethodId>(available[0]);
	let view = $state<'challenge' | 'switch'>('challenge');
	let digits = $state<string[]>(Array(6).fill(''));
	let bcode = $state('');
	let editedSinceError = $state(false);
	let keyAttempted = $state(false);
	let otpRefs: HTMLInputElement[] = $state([]);

	const showBad = $derived(error !== null && !editedSinceError);
	const code = $derived(digits.join(''));

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
		digits = Array(6).fill('');
		bcode = '';
		editedSinceError = true;
		keyAttempted = false;
	}

	function verifyCode(value?: string) {
		const c = value ?? code;
		if (c.length < 6 || busy) return;
		onTotp(c);
	}

	function verifyBackup() {
		if (bcode.trim().length < 8 || busy) return;
		onBackupCode(bcode.trim());
	}

	function setDigit(i: number, v: string) {
		const c = v.replace(/\D/g, '').slice(-1);
		editedSinceError = true;
		digits = digits.map((d, k) => (k === i ? c : d));
		if (c && otpRefs[i + 1]) otpRefs[i + 1].focus();
	}

	function otpKey(i: number, e: KeyboardEvent) {
		if (e.key === 'Backspace' && !digits[i] && i > 0) {
			e.preventDefault();
			otpRefs[i - 1]?.focus();
		} else if (e.key === 'Enter') {
			verifyCode();
		}
	}

	function otpPaste(e: ClipboardEvent) {
		const t = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
		if (!t) return;
		e.preventDefault();
		editedSinceError = true;
		const next = Array(6)
			.fill('')
			.map((_, k) => t[k] ?? '');
		digits = next;
		const last = Math.min(5, t.length - 1);
		otpRefs[last]?.focus();
		if (t.length >= 6) verifyCode(next.join(''));
	}

	function retryKey() {
		if (busy) return;
		editedSinceError = true;
		onWebauthn();
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet retry(t: string)}<button type="button" class="linklike" onclick={retryKey}>{t}</button>{/snippet}
{#snippet addrLede(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet addrHint(t: string)}<span class="mono">{t}</span>{/snippet}

{#if view === 'switch'}
	{@render top?.()}
	<div class="card-head">
		<p class="eyebrow">{eyebrowText}</p>
		<h1>{m.auth_2fa_switch_title()}</h1>
		<p>{m.auth_2fa_switch_lede()}</p>
	</div>
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
	<div class="actions" style="margin-top:18px">
		<Button variant="ghost" size="lg" block onclick={() => (view = 'challenge')}>
			<ArrowLeft size={17} strokeWidth={1.75} />{META[method].back()}
		</Button>
	</div>
{:else}
	{@render top?.()}
	<div class="card-head">
		<p class="eyebrow">{eyebrowText}</p>
		<h1>{m.auth_2fa_title()}</h1>
		{#if lede}
			<p>{@render lede()}</p>
		{:else}
			<p><Rich text={m.auth_2fa_lede({ email })} tags={{ addr: addrLede }} /></p>
		{/if}
	</div>
	<div class="form">
		{#if method === 'app'}
			<div class="field">
				<div class="lab"><label for="otp-0">{m.auth_2fa_code_label()}</label></div>
				<div class="otpgrid" class:shake={showBad}>
					{#each digits as d, i (i)}
						<input
							id={'otp-' + i}
							bind:this={otpRefs[i]}
							value={d}
							class:err={showBad}
							type="text"
							inputmode="numeric"
							autocomplete="one-time-code"
							spellcheck="false"
							disabled={busy}
							oninput={(e) => setDigit(i, e.currentTarget.value)}
							onkeydown={(e) => otpKey(i, e)}
							onpaste={otpPaste}
						/>
					{/each}
				</div>
				{#if showBad}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>{m.auth_2fa_code_mismatch()}</span>
					</span>
				{:else}
					<span class="hint">
						<Rich text={m.auth_2fa_code_hint({ email })} tags={{ addr: addrHint }} />
					</span>
				{/if}
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={code.length < 6 || busy} onclick={() => verifyCode()}>
					{#if busy}
						<span class="spinner"></span>{m.auth_2fa_checking()}
					{:else}
						{m.auth_2fa_verify_code()}
					{/if}
				</Button>
			</div>
		{:else if method === 'key'}
			<div class="tfa-wait">
				<span class="tw-ring"></span>
				<span class="tw-ic"><Usb size={26} strokeWidth={1.75} /></span>
			</div>
			<div class="tfa-status">
				{#if busy}
					<span><Rich text={m.auth_2fa_key_busy()} tags={{ b: bold }} /></span>
				{:else if showBad}
					<span><Rich text={m.auth_2fa_key_failed()} tags={{ b: bold, retry }} /></span>
				{:else}
					<span><Rich text={m.auth_2fa_key_waiting()} tags={{ b: bold, retry }} /></span>
				{/if}
			</div>
		{:else}
			<div class="field">
				<div class="lab"><label for="twofa-backup">{m.auth_2fa_method_backup()}</label></div>
				<input
					id="twofa-backup"
					class="inp mono"
					class:err={showBad}
					value={bcode}
					placeholder="XXXX-XXXX"
					autocomplete="off"
					spellcheck="false"
					disabled={busy}
					style="text-align:center;letter-spacing:.12em"
					oninput={(e) => {
						editedSinceError = true;
						bcode = e.currentTarget.value.toUpperCase();
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') verifyBackup();
					}}
				/>
				{#if showBad}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>{m.auth_2fa_backup_invalid()}</span>
					</span>
				{:else}
					<span class="hint">{m.auth_2fa_backup_hint()}</span>
				{/if}
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={bcode.trim().length < 8 || busy} onclick={verifyBackup}>
					{#if busy}
						<span class="spinner"></span>{m.auth_2fa_checking()}
					{:else}
						{m.auth_2fa_use_backup()}
					{/if}
				</Button>
			</div>
		{/if}
	</div>
	<p class="switch">
		{#if available.length > 1}
			<button type="button" class="linklike" onclick={() => (view = 'switch')}>{m.auth_2fa_try_another()}</button>
			<span>&nbsp;&middot;&nbsp;</span>
		{/if}
		<button type="button" class="linklike" onclick={onBack}>
			{backText}
		</button>
	</p>
{/if}

<style>
	.linklike {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--link, var(--pine-700));
		font-weight: 500;
		cursor: pointer;
	}
	.linklike:hover {
		text-decoration: underline;
	}
</style>
