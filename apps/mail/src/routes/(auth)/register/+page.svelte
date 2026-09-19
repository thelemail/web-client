<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import PasswordStrength from '$core/auth/PasswordStrength.svelte';
	import { passwordReqs } from '$core/auth/password-policy';
	import Stepper from '$core/auth/Stepper.svelte';
	import PlanStep from '$core/auth/PlanStep.svelte';
	import PaymentStep from '$core/auth/PaymentStep.svelte';
	import {
		findPlan,
		planFromQuery,
		planTotal,
		pricePerPeriod,
		periodFromQuery,
		type PlanSelection
	} from '$core/auth/plans';
	import { performLogin } from '$core/auth/perform-login';
	import { createRegistrationProof, withRegistrationProof } from '$core/auth/registration-proof';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { createCheckoutSession, type PlanCode } from '$core/api/billing';
	import { changeMyWorkspaceType } from '$core/api/workspaces';
	import brandmark from '$core/assets/logo-mark.svg';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import Mail from '@lucide/svelte/icons/mail';
	import { checkAddressAvailability, registrationInit, register } from '$core/api/auth';
	import { ApiCallError } from '$core/api/types';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/auth.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const addMode = $derived(page.url.searchParams.get('addAccount') === '1');
	const signInHref = $derived.by(() => {
		const q = new URLSearchParams();
		if (addMode) q.set('addAccount', '1');
		const back = page.url.searchParams.get('redirect');
		if (back) q.set('redirect', back);
		const s = q.toString();
		return s ? `/login?${s}` : '/login';
	});
	const acquisitionSource = page.url.searchParams.get('src') ?? 'register';
	const preselectedPeriod = periodFromQuery(page.url.searchParams.get('billing'));
	const preselected = planFromQuery(page.url.searchParams.get('plan'), preselectedPeriod);

	const HANDLE_RE = /^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$/;

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

	const proof = createRegistrationProof();

	$effect(() => {
		if (step === 1) untrack(() => proof.prepare());
	});

	$effect(() => () => proof.dispose());

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

	const labels = $derived(
		paid
			? [
					m.auth_step_address(),
					m.auth_step_password(),
					m.auth_step_plan(),
					m.auth_step_payment()
				]
			: [m.auth_step_address(), m.auth_step_password()]
	);
	const totalSteps = $derived(labels.length);
	const product = $derived(findPlan(sel).product);
	const audience = $derived(paid ? product.id : 'personal');

	const heading = $derived.by(() => {
		if (audience === 'family') return m.auth_register_heading_family();
		if (audience === 'business') return m.auth_register_heading_business();
		return m.auth_register_heading_personal();
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
		return tier
			? m.auth_register_plan_label({
					plan: tier.name,
					price: pricePerPeriod(planTotal(sel), sel.period)
				})
			: null;
	});

	function planCodeFor(selection: PlanSelection): PlanCode | null {
		const { tier } = findPlan(selection);
		if (!tier) return null;
		return tier.id.replace(/-/g, '_') as PlanCode;
	}

	function registerErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError && (err.status === 503 || err.status === 429)) {
			return m.auth_register_busy_error();
		}
		return err instanceof Error ? err.message : m.auth_register_failed();
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
			const init = await withRegistrationProof(proof, (payload) =>
				registrationInit({ email, registrationRequest: start.registrationRequest, proof: payload })
			);
			const finish = await keystore.opaqueFinishRegistration({
				operationId: start.operationId,
				accountId: init.accountId,
				registrationResponse: init.registrationResponse
			});
			if (!finish.ok) {
				throw new Error(m.auth_register_keys_failed());
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
		await goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot));
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
	<title>{m.auth_register_page_title()}</title>
</svelte:head>

{#snippet freeButton(t: string)}
	<button type="button" class="linklike" disabled={submitting} onclick={chooseFree}>{t}</button>
{/snippet}
{#snippet strong(t: string)}<strong>{t}</strong>{/snippet}
{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet domain(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet signInLink(t: string)}<a href="/login">{t}</a>{/snippet}

{#snippet freeFoot()}
	<p class="switch">
		<Rich text={m.auth_register_free_foot()} tags={{ free: freeButton }} />
	</p>
{/snippet}

{#if step === 0}
	<div class="card-surface screen-fade">
		<Stepper step={0} {labels} />
		<div class="card-head">
			{#if addMode && auth.email}
				<p class="eyebrow">{m.auth_login_add_eyebrow()}</p>
				<h1>{m.auth_register_add_title()}</h1>
				<p>
					<Rich text={m.auth_register_add_lede({ email: auth.email })} tags={{ b: strong }} />
				</p>
			{:else}
				<p class="eyebrow">{m.auth_step_of({ step: 1, total: totalSteps })}</p>
				<h1>{heading}</h1>
			{/if}
			{#if audience === 'family'}
				<p><Rich text={m.auth_register_lede_family()} tags={{ domain }} /></p>
			{:else if audience === 'business'}
				<p><Rich text={m.auth_register_lede_business()} tags={{ domain }} /></p>
			{:else}
				<p><Rich text={m.auth_register_lede_personal()} tags={{ domain }} /></p>
			{/if}
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="register-name">{m.auth_register_name_label()}</label></div>
				<input
					id="register-name"
					class="inp"
					type="text"
					bind:value={fullName}
					placeholder={m.auth_register_name_placeholder()}
					autocomplete="name"
					maxlength={120}
					spellcheck="true"
				/>
				<span class="hint">{m.auth_register_name_hint()}</span>
			</div>
			<div class="field">
				<div class="lab"><label for="register-handle">{m.common_email_address()}</label></div>
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
						placeholder={m.auth_register_handle_placeholder()}
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
					<span class="hint">{m.auth_register_handle_hint()}</span>
				{:else if status === 'invalid'}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>{m.auth_register_handle_invalid()}</span>
					</span>
				{:else if status === 'checking'}
					<span class="hint">{m.auth_register_handle_checking()}</span>
				{:else if status === 'taken'}
					<span class="errtext">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>{m.auth_register_handle_taken()}</span>
					</span>
				{:else if status === 'available'}
					<span class="hint">
						<Rich
							text={m.auth_register_handle_available({ address: `${handle}@thelemail.com` })}
							tags={{ b: bold }}
						/>
					</span>
				{/if}
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={!addressReady} onclick={() => (step = 1)}>
					{m.common_continue()}<ArrowRight size={17} strokeWidth={1.75} />
				</Button>
			</div>
		</div>
		<p class="switch">
			<Rich text={m.auth_register_have_account()} tags={{ link: signInLink }} />
		</p>
	</div>
{:else if step === 1}
	<div class="card-surface screen-fade">
		<Stepper step={1} {labels} />
		<div class="card-head">
			<p class="eyebrow">{m.auth_step_of({ step: 2, total: totalSteps })}</p>
			<h1>{m.auth_register_password_title()}</h1>
			<p>
				<Rich
					text={m.auth_register_password_securing({ address: `${handle}@thelemail.com` })}
					tags={{ addr: domain }}
				/>
			</p>
		</div>
		<div class="form">
			<PasswordField
				label={m.common_password()}
				bind:value={pw}
				placeholder={m.auth_register_password_placeholder()}
				autocomplete="new-password"
			/>
			<PasswordStrength {pw} />
			<PasswordField
				label={m.auth_register_confirm_label()}
				bind:value={confirm}
				placeholder={m.auth_register_confirm_placeholder()}
				autocomplete="new-password"
				onEnter={continueFromPassword}
			/>
			{#if mismatch}
				<span class="errtext" style="margin-top:-8px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>{m.auth_register_passwords_mismatch()}</span>
				</span>
			{:else if matches}
				<span class="oktext" style="margin-top:-8px">
					<CircleCheck size={13} strokeWidth={1.75} />
					<span>{m.auth_register_passwords_match()}</span>
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
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} disabled={submitting} onclick={() => (step = 0)}>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</Button>
					<Button variant="primary" size="lg" disabled={!passwordReady || submitting} onclick={continueFromPassword}>
						{#if submitting}
							{m.auth_register_creating()}
						{:else if paid}
							{m.common_continue()}<ArrowRight size={17} strokeWidth={1.75} />
						{:else}
							{m.auth_register_create_mailbox()}<ArrowRight size={17} strokeWidth={1.75} />
						{/if}
					</Button>
				</div>
				{#if paid}
					<Button variant="ghost" size="lg" block disabled={submitting} onclick={chooseFree}>
						{m.auth_register_free_instead()}
					</Button>
				{:else}
					<Button variant="ghost" size="lg" block disabled={!passwordReady || submitting} onclick={choosePaid}>
						{m.auth_register_paid_instead()}
					</Button>
				{/if}
			</div>
		</div>
		{#if paid}
			<p class="legal">{m.auth_register_legal_paid()}</p>
		{:else}
			<p class="legal">{m.auth_register_legal_free()}</p>
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
			<h1>{m.auth_register_submitted_title()}</h1>
			<p>
				<Rich
					text={m.auth_register_submitted_body({ address: `${handle}@thelemail.com` })}
					tags={{ b: bold }}
				/>
			</p>
			<div class="addrcard">
				<span class="av">{initials}</span>
				<span class="em">{handle}@thelemail.com</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			{#if planLabel}
				<p class="planline">
					<CircleCheck size={14} strokeWidth={1.75} />
					<span><Rich text={m.auth_register_plan_pending({ plan: planLabel })} tags={{ b: bold }} /></span>
				</p>
			{/if}
			<div class="actions" style="margin-top:24px">
				<Button variant="primary" size="lg" block onclick={() => goto(signInHref)}>
					<Mail size={17} strokeWidth={1.75} />{m.auth_sign_in()}
				</Button>
			</div>
		</div>
	</div>
{/if}
