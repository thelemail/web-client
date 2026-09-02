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
	import {
		eur,
		findPlan,
		planFromQuery,
		planTotal,
		periodFromQuery,
		type PlanSelection
	} from '$lib/auth/plans';
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
	const preselectedPeriod = periodFromQuery(page.url.searchParams.get('billing'));
	const preselected = planFromQuery(page.url.searchParams.get('plan'), preselectedPeriod);

	const HANDLE_RE = /^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$/;
	const FREE_LABELS = ['Address', 'Password'];
	const PAID_LABELS = ['Address', 'Password', 'Plan', 'Payment'];

	let step = $state<0 | 1 | 2 | 3 | 4>(0);
	let paid = $state(preselected !== null);
	let fullName = $state('');
	let handle = $state('');
	let pw = $state('');
	let confirm = $state('');
	let sel = $state<PlanSelection>(
		preselected ?? { product: 'personal', tier: null, seats: 3, period: preselectedPeriod }
	);

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

	const labels = $derived(paid ? PAID_LABELS : FREE_LABELS);
	const totalSteps = $derived(labels.length);
	const product = $derived(findPlan(sel).product);
	const audience = $derived(paid ? product.id : 'personal');

	const heading = $derived.by(() => {
		if (audience === 'family') return 'Set up email for your household';
		if (audience === 'business') return 'Set up email for your team';
		return 'Claim your address';
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
		if (!paid) return null;
		const { tier } = findPlan(sel);
		return tier ? `${tier.name} plan · ${eur(planTotal(sel))} / ${sel.period}` : null;
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

	function choosePaid() {
		paid = true;
		step = 2;
	}

	function chooseFree() {
		paid = false;
		sel = { product: 'personal', tier: null, seats: 3, period: sel.period };
		step = 1;
	}

	function continueFromPassword() {
		if (!passwordReady) return;
		if (!paid) {
			void createFree();
			return;
		}
		step = planCodeFor(sel) ? 3 : 2;
	}

	async function registerAndLogin(): Promise<number | null> {
		const email = `${handle}@thelemail.com`;
		const password = pw;
		const plan = paid ? planCodeFor(sel) : null;
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
				plan: plan ?? undefined,
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

	async function createFree() {
		if (submitting || !passwordReady) return;
		submitting = true;
		submitError = null;
		const slot = await registerAndLogin();
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
		const slot = await registerAndLogin();
		if (slot === null) return;

		try {
			if (product.id !== 'personal') {
				await changeMyWorkspaceType({ type: product.id });
			}
			const origin = platform.returnOrigin();
			const { url } = await createCheckoutSession({
				planCode,
				interval: sel.period,
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

{#snippet freeFoot()}
	<p class="switch">
		Not ready to pay?
		<button type="button" class="linklike" disabled={submitting} onclick={chooseFree}>
			Start with the free plan
		</button>
	</p>
{/snippet}

{#if step === 0}
	<div class="card-surface screen-fade">
		<Stepper step={0} {labels} />
		<div class="card-head">
			{#if addMode && auth.email}
				<p class="eyebrow">Add another account</p>
				<h1>Create a second account</h1>
				<p>
					You're signed in as <strong>{auth.email}</strong>. The new account will be added alongside
					it on this device &mdash; both stay signed in.
				</p>
			{:else}
				<p class="eyebrow">Step 1 of {totalSteps}</p>
				<h1>{heading}</h1>
			{/if}
			{#if audience === 'family'}
				<p>
					Start with your own address on
					<span class="mono" style="color:var(--ink-700)">thelemail.com</span>. It becomes the
					administrator account for the household, and you connect your family's domain from
					Settings once the account exists.
				</p>
			{:else if audience === 'business'}
				<p>
					Start with your own address on
					<span class="mono" style="color:var(--ink-700)">thelemail.com</span>. It becomes the
					administrator account for the team, and you connect your company domain from Settings
					once the account exists.
				</p>
			{:else}
				<p>
					Pick a name on <span class="mono" style="color:var(--ink-700)">thelemail.com</span>. You
					can add your own domain later.
				</p>
			{/if}
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
		<Stepper step={1} {labels} />
		<div class="card-head">
			<p class="eyebrow">Step 2 of {totalSteps}</p>
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
				onEnter={continueFromPassword}
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
					<button
						class="btn btn-primary"
						disabled={!passwordReady || submitting}
						onclick={continueFromPassword}
					>
						{#if submitting}
							Creating your mailbox…
						{:else if paid}
							Continue<ArrowRight size={17} strokeWidth={1.75} />
						{:else}
							Create my mailbox<ArrowRight size={17} strokeWidth={1.75} />
						{/if}
					</button>
				</div>
				{#if paid}
					<button
						class="btn btn-ghost btn-block"
						disabled={submitting}
						onclick={chooseFree}
					>
						Start with the free plan instead
					</button>
				{:else}
					<button
						class="btn btn-ghost btn-block"
						disabled={!passwordReady || submitting}
						onclick={choosePaid}
					>
						Choose a paid plan instead
					</button>
				{/if}
			</div>
		</div>
		{#if paid}
			<p class="legal">
				Your account is created first, then you pick up where you left off at checkout. Nothing is
				charged until you confirm there.
			</p>
		{:else}
			<p class="legal">
				The free plan is a real mailbox on thelemail.com with 1 GB of storage, no card required.
				Upgrade whenever you want your own domain, more storage, or more people.
			</p>
		{/if}
	</div>
{:else if step === 2}
	<PlanStep
		bind:sel
		{labels}
		busy={submitting}
		onBack={() => (step = 1)}
		onNext={() => (step = 3)}
		footer={freeFoot}
	/>
{:else if step === 3}
	<PaymentStep
		{handle}
		{sel}
		{labels}
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
				If <b>{handle}@thelemail.com</b> is new, your mailbox is ready &mdash; sign in to open it.
				If the address was already taken, the existing owner has been notified.
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
