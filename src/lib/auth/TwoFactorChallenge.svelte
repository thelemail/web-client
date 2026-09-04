<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Usb from '@lucide/svelte/icons/usb';
	import type { TwoFactorMethod } from '$lib/api/types';
	import { webauthnSupported } from '$lib/auth/webauthn';
	import { Button } from '$lib/components/ui/button';

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
		eyebrow = 'Two-factor check',
		lede,
		top,
		backLabel = 'Back to sign in',
		onTotp,
		onBackupCode,
		onWebauthn,
		onBack
	}: Props = $props();

	type MethodId = 'app' | 'key' | 'backup';

	const META: Record<MethodId, { label: string; pick: string }> = {
		app: { label: 'Authenticator app', pick: 'Enter a 6-digit code from your app' },
		key: { label: 'Security key / passkey', pick: 'Touch your key, or use Touch ID or your screen lock' },
		backup: { label: 'Backup code', pick: 'Use one of your one-time backup codes' }
	};

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

	function switchTo(m: MethodId) {
		method = m;
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

{#if view === 'switch'}
	{@render top?.()}
	<div class="card-head">
		<p class="eyebrow">{eyebrow}</p>
		<h1>Another way to confirm</h1>
		<p>Any second factor on this account will do.</p>
	</div>
	<div class="altlist">
		{#each available.filter((m) => m !== method) as m (m)}
			<button type="button" class="altopt" onclick={() => switchTo(m)}>
				<span class="alt-ic">
					{#if m === 'app'}<Smartphone size={17} strokeWidth={1.75} />
					{:else if m === 'key'}<Usb size={17} strokeWidth={1.75} />
					{:else}<LifeBuoy size={17} strokeWidth={1.75} />{/if}
				</span>
				<span class="alt-tx"><b>{META[m].label}</b><span>{META[m].pick}</span></span>
				<span class="alt-chev"><ChevronRight size={16} strokeWidth={1.75} /></span>
			</button>
		{/each}
	</div>
	<div class="actions" style="margin-top:18px">
		<Button variant="ghost" size="lg" block onclick={() => (view = 'challenge')}>
			<ArrowLeft size={17} strokeWidth={1.75} />Back to {META[method].label.toLowerCase()}
		</Button>
	</div>
{:else}
	{@render top?.()}
	<div class="card-head">
		<p class="eyebrow">{eyebrow}</p>
		<h1>Confirm it&rsquo;s you</h1>
		{#if lede}
			<p>{@render lede()}</p>
		{:else}
			<p><span class="mono" style="color:var(--ink-700)">{email}</span> asks for a second factor.</p>
		{/if}
	</div>
	<div class="form">
		{#if method === 'app'}
			<div class="field">
				<div class="lab"><label for="otp-0">6-digit code</label></div>
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
						<span>That code didn&rsquo;t match. Codes rotate every 30 seconds &mdash; try the current one.</span>
					</span>
				{:else}
					<span class="hint">
						Open your authenticator app and enter the code for <span class="mono">{email}</span>.
					</span>
				{/if}
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={code.length < 6 || busy} onclick={() => verifyCode()}>
					{#if busy}
						<span class="spinner"></span>Checking&hellip;
					{:else}
						Verify code
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
					<span><b>Waiting for your authenticator.</b> Follow the browser prompt &mdash; touch your key, or use Touch ID or your screen lock.</span>
				{:else if showBad}
					<span><b>That didn&rsquo;t verify.</b> <button type="button" class="linklike" onclick={retryKey}>Try again</button></span>
				{:else}
					<span><b>Waiting for your security key or passkey.</b> No prompt? <button type="button" class="linklike" onclick={retryKey}>Try again</button></span>
				{/if}
			</div>
		{:else}
			<div class="field">
				<div class="lab"><label for="twofa-backup">Backup code</label></div>
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
						<span>That code isn&rsquo;t valid &mdash; it may have been used already. Each works once.</span>
					</span>
				{:else}
					<span class="hint">One of the codes you saved when you set up two-factor. Each works once.</span>
				{/if}
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={bcode.trim().length < 8 || busy} onclick={verifyBackup}>
					{#if busy}
						<span class="spinner"></span>Checking&hellip;
					{:else}
						Use backup code
					{/if}
				</Button>
			</div>
		{/if}
	</div>
	<p class="switch">
		{#if available.length > 1}
			<button type="button" class="linklike" onclick={() => (view = 'switch')}>Try another way</button>
			<span>&nbsp;&middot;&nbsp;</span>
		{/if}
		<button type="button" class="linklike" onclick={onBack}>
			{backLabel}
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
