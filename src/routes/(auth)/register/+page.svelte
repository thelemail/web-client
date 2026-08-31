<script lang="ts">
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import PasswordField from '$lib/auth/PasswordField.svelte';
	import PasswordStrength from '$lib/auth/PasswordStrength.svelte';
	import { passwordReqs } from '$lib/auth/password-policy';
	import Stepper from '$lib/auth/Stepper.svelte';
	import PlanStep from '$lib/auth/PlanStep.svelte';
	import PaymentStep from '$lib/auth/PaymentStep.svelte';
	import { findPlan, planTotal, type PlanSelection } from '$lib/auth/plans';
	import { performLogin } from '$lib/auth/perform-login';
	import { createCheckoutSession, type PlanCode } from '$lib/api/billing';
	import { changeMyWorkspaceType } from '$lib/api/workspaces';
	import brandmark from '$lib/assets/logo-mark.svg';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import Mail from '@lucide/svelte/icons/mail';
	import { checkAddressAvailability, registrationInit, register } from '$lib/api/auth';
	import { ApiCallError } from '$lib/api/types';
	import { keystore } from '$lib/keystore/keystore-client';
	import { auth } from '$lib/stores/auth.svelte';

	const addMode = $derived(page.url.searchParams.get('addAccount') === '1');
	const acquisitionSource = page.url.searchParams.get('src') ?? 'register';

	const HANDLE_RE = /^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$/;
	const REG_LABELS = ['Address', 'Password', 'Plan', 'Payment'];

	let step = $state<0 | 1 | 2 | 3 | 4>(0);
	let fullName = $state('');
	let handle = $state('');
	let pw = $state('');
	let confirm = $state('');
	let sel = $state<PlanSelection>({ product: 'personal', tier: null, seats: 3 });

	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	let status = $state<'idle' | 'invalid' | 'checking' | 'taken' | 'available'>('idle');

	$effect(() => {
		const h = handle.trim().toLowerCase();
		if (!h) {
			status = 'idle';
			return;
		}
		if (!HANDLE_RE.test(h)) {
			status = 'invalid';
			return;
		}
		status = 'checking';
		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const { available } = await checkAddressAvailability(h);
				if (!cancelled) status = available ? 'available' : 'taken';
			} catch {
				if (!cancelled) status = 'available';
			}
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	const nameReady = $derived(fullName.trim().length > 0 && fullName.trim().length <= 120);
	const addressReady = $derived(status === 'available' && nameReady);

	const allMet = $derived(passwordReqs(pw).every((r) => r.met));
	const matches = $derived(confirm.length > 0 && confirm === pw);
	const mismatch = $derived(confirm.length > 0 && confirm !== pw);
	const passwordReady = $derived(allMet && matches);

	const initials = $derived(
		(handle.replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'th').toUpperCase()
	);

	const planLabel = $derived.by(() => {
		const { tier } = findPlan(sel);
		return tier ? `${tier.name} plan · €${planTotal(sel)} / year` : null;
	});

	function planCodeFor(selection: PlanSelection): PlanCode | null {
		const { tier } = findPlan(selection);
		if (!tier) return null;
		return tier.id.replace(/-/g, '_') as PlanCode;
	}

	function registerErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError && (err.status === 503 || err.status === 429)) {
			return "We couldn't finish that just now. Try again in a few minutes.";
		}
		return err instanceof Error ? err.message : 'Registration failed';
	}

	async function registerAndLogin(startTrial: boolean): Promise<number | null> {
		const email = `${handle}@thelemail.com`;
		const password = pw;
		try {
			const start = await keystore.opaqueStartRegistration({ email, password });
			const init = await registrationInit({ email, registrationRequest: start.registrationRequest });
			const finish = await keystore.opaqueFinishRegistration({
				operationId: start.operationId,
				accountId: init.accountId,
				registrationResponse: init.registrationResponse
			});
			if (!finish.ok) {
				throw new Error('Could not prepare your mailbox keys. Please try again.');
			}
			await register({
				email,
				fullName: fullName.trim(),
				registrationId: init.registrationId,
				opaqueRecord: finish.opaqueRecord,
				wrappedMasterKey: finish.wrappedMasterKey,
				masterKeyId: finish.masterKeyId,
				opaqueParamsVersion: finish.opaqueParamsVersion,
				publicKey: finish.publicKey,
				encryptedPrivateKey: finish.encryptedPrivateKey,
				keyAlgorithm: finish.keyAlgorithm,
				startTrial,
				source: acquisitionSource
			});
			await keystore.opaqueFinalizeRegister({ operationId: start.operationId, accountId: init.accountId });
		} catch (err) {
			submitError = registerErrorMessage(err);
			submitting = false;
			return null;
		}
		try {
			const outcome = await performLogin({ email, password });
			if (outcome.status !== 'complete') {
				throw new Error('unexpected two-factor challenge on a fresh account');
			}
			pw = '';
			confirm = '';
			return outcome.result.slot;
		} catch {
			pw = '';
			confirm = '';
			step = 4;
			submitting = false;
			return null;
		}
	}

	async function startTrial() {
		if (submitting || !passwordReady) return;
		submitting = true;
		submitError = null;
		const slot = await registerAndLogin(true);
		if (slot === null) return;
		await goto(`/u/${slot}/mail/inbox`);
	}

	async function submitRegistration() {
		if (submitting || !passwordReady) return;
		const planCode = planCodeFor(sel);
		if (!planCode) {
			step = 2;
			return;
		}
		submitting = true;
		submitError = null;
		const slot = await registerAndLogin(false);
		if (slot === null) return;

		try {
			const { product } = findPlan(sel);
			if (product.id !== 'personal') {
				await changeMyWorkspaceType({ type: product.id });
			}
			const origin = platform.returnOrigin();
			const { url } = await createCheckoutSession({
				planCode,
				seats: product.perMailbox ? sel.seats : undefined,
				successUrl: `${origin}/u/${slot}/billing/return`,
				cancelUrl: `${origin}/u/${slot}/billing/choose?canceled=1`
			});
			platform.openExternal(url);
		} catch (err) {
			submitting = false;
			console.error('register: checkout session failed', err);
			await goto(`/u/${slot}/billing/choose`);
		}
	}
</script>

<svelte:head>
	<title>Thelemail — Create account</title>
</svelte:head>

{#if step === 0}
	<div class="card-surface screen-fade">
		<Stepper step={0} labels={REG_LABELS} />
		<div class="card-head">
			{#if addMode && auth.email}
				<p class="eyebrow">Add another account</p>
				<h1>Create a second account</h1>
				<p>
					You're signed in as <strong>{auth.email}</strong>. The new account will be added alongside
					it on this device — both stay signed in.
				</p>
			{:else}
				<p class="eyebrow">Step 1 of 4</p>
				<h1>Claim your address</h1>
			{/if}
			<p>
				Pick a name on <span class="mono" style="color:var(--ink-700)">thelemail.com</span>. You can
				add your own domain later.
			</p>
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="register-name">Full name</label></div>
				<input
					id="register-name"
					class="inp"
					type="text"
					bind:value={fullName}
					placeholder="Camille Rabelais"
					autocomplete="name"
					maxlength={120}
					spellcheck="true"
				/>
				<span class="hint">Shown to people you write to.</span>
			</div>
			<div class="field">
				<div class="lab"><label for="register-handle">Email address</label></div>
				<div
					class="affix"
					class:ok={status === 'available'}
					class:err={status === 'invalid' || status === 'taken'}
				>
					<input
						id="register-handle"
						bind:value={handle}
						oninput={(e) =>
							(handle = e.currentTarget.value.toLowerCase().replace(/\s+/g, ''))}
						placeholder="françois"
						maxlength={30}
						autocomplete="off"
						spellcheck="false"
						onkeydown={(e) => {
							if (e.key === 'Enter' && addressReady) step = 1;
						}}
					/>
					<span class="suf">@thelemail.com</span>
					<span class="statusic">
						{#if status === 'available'}
							<span class="ok-c"><CircleCheck size={17} strokeWidth={1.75} /></span>
						{:else if status === 'invalid' || status === 'taken'}
							<span class="bad-c"><CircleAlert size={17} strokeWidth={1.75} /></span>
						{/if}
					</span>
				</div>
				{#if status === 'idle'}
					<span class="hint">Letters, numbers, dots, hyphens. 3&ndash;30 characters.</span>
				{:else if status === 'invalid'}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>Use 3&ndash;30 letters, numbers, dots or hyphens.</span>
					</span>
				{:else if status === 'checking'}
					<span class="hint">Checking availability&hellip;</span>
				{:else if status === 'taken'}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>That address is already taken &mdash; please choose another.</span>
					</span>
				{:else if status === 'available'}
					<span class="hint">
						If <b>{handle}@thelemail.com</b> is new, we'll set it up. If it isn't, we'll let the
						existing owner know.
					</span>
				{/if}
			</div>
			<div class="actions">
				<button
					class="btn btn-primary btn-block"
					disabled={!addressReady}
					onclick={() => (step = 1)}
				>
					Continue<ArrowRight size={17} strokeWidth={1.75} />
				</button>
			</div>
		</div>
		<p class="switch">
			Already have an account? <a href="/login">Sign in</a>
		</p>
	</div>
{:else if step === 1}
	<div class="card-surface screen-fade">
		<Stepper step={1} labels={REG_LABELS} />
		<div class="card-head">
			<p class="eyebrow">Step 2 of 4</p>
			<h1>Set a password</h1>
			<p>
				Securing <span class="mono" style="color:var(--ink-700)">{handle}@thelemail.com</span>
			</p>
		</div>
		<div class="form">
			<PasswordField
				label="Password"
				bind:value={pw}
				placeholder="Create a strong password"
				autocomplete="new-password"
			/>
			<PasswordStrength {pw} />
			<PasswordField
				label="Confirm password"
				bind:value={confirm}
				placeholder="Re-enter password"
				autocomplete="new-password"
				onEnter={() => {
					if (passwordReady) step = 2;
				}}
			/>
			{#if mismatch}
				<span class="errtext" style="margin-top:-8px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>Passwords don&rsquo;t match.</span>
				</span>
			{:else if matches}
				<span class="oktext" style="margin-top:-8px">
					<CircleCheck size={13} strokeWidth={1.75} />
					<span>Passwords match.</span>
				</span>
			{/if}
			{#if submitError}
				<span class="errtext" style="margin-top:-4px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>{submitError}</span>
				</span>
			{/if}
			<div class="actions">
				<div class="btnrow">
					<button
						class="btn btn-secondary btn-back"
						aria-label="Back"
						disabled={submitting}
						onclick={() => (step = 0)}
					>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</button>
					<button class="btn btn-primary" disabled={!passwordReady || submitting} onclick={startTrial}>
						Start 30-day free trial<ArrowRight size={17} strokeWidth={1.75} />
					</button>
				</div>
				<button
					class="btn btn-ghost btn-block"
					disabled={!passwordReady || submitting}
					onclick={() => (step = 2)}
				>
					Choose a paid plan instead
				</button>
			</div>
		</div>
		<p class="legal">
			The free trial is a full mailbox for 30 days, no card required. Pick a plan whenever you like.
			When the trial ends you keep read-only access and can export everything before anything is
			removed.
		</p>
	</div>
{:else if step === 2}
	<PlanStep
		bind:sel
		labels={REG_LABELS}
		trialProduct="personal"
		onStartTrial={startTrial}
		busy={submitting}
		onBack={() => (step = 1)}
		onNext={() => (step = 3)}
	/>
{:else if step === 3}
	<PaymentStep
		{handle}
		{sel}
		labels={REG_LABELS}
		{submitting}
		error={submitError}
		onBack={() => (step = 2)}
		onChangePlan={() => (step = 2)}
		onPay={submitRegistration}
	/>
{:else}
	<div class="card-surface screen-fade">
		<div class="welcome">
			<img class="brandmark brandmark-lg" src={brandmark} alt="Thelemail" />
			<h1>Submitted</h1>
			<p>
				If <b>{handle}@thelemail.com</b> is new, your mailbox is provisioned &mdash; sign in to
				finish checkout and activate it. If the address was already taken, the existing owner has
				been notified.
			</p>
			<div class="addrcard">
				<span class="av">{initials}</span>
				<span class="em">{handle}@thelemail.com</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			{#if planLabel}
				<p class="planline">
					<CircleCheck size={14} strokeWidth={1.75} />
					<span><b>{planLabel}</b> &mdash; ready to complete after sign-in</span>
				</p>
			{/if}
			<div class="actions" style="margin-top:24px">
				<button
					class="btn btn-primary btn-block"
					onclick={() => goto(addMode ? '/login?addAccount=1' : '/login')}
				>
					<Mail size={17} strokeWidth={1.75} />Sign in
				</button>
			</div>
		</div>
	</div>
{/if}
