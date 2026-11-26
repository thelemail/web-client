<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { passwordReqs } from '$core/auth/password-policy';
	import TextField from '$core/auth/form/TextField.svelte';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import PasswordChecks from '$core/auth/form/PasswordChecks.svelte';
	import WorkSteps from '$core/auth/form/WorkSteps.svelte';
	import Status from '$core/auth/form/Status.svelte';
	import { handleSuggestions } from '$core/auth/handle-suggestions';
	import { unfold } from '$core/auth/form/unfold';
	import DoneMark from '$core/auth/form/DoneMark.svelte';
	import StepPills from '$core/auth/form/StepPills.svelte';
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
	import { createProofOfWork, withProofOfWork } from '$core/auth/proof-of-work';
	import type { PlanCode } from '$core/api/billing';
	import { delayed } from '$core/async/delayed.svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faCircleCheck } from '@fortawesome/pro-regular-svg-icons';
	import { checkAddressAvailability, registrationInit, register } from '$core/api/auth';
	import { endSignupSession, signupSession } from '$core/auth/signup-session';
	import { ApiCallError } from '$core/api/types';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/session.svelte';
	import { platformDomains } from '$core/stores/platformDomains.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';
	import type { RegisterCheckout } from './register-checkout';

	let {
		afterRegister,
		checkout,
		remember = false
	}: {
		afterRegister: (slot: number) => Promise<unknown>;
		checkout: (slot: number, order: RegisterCheckout) => Promise<unknown>;
		remember?: boolean;
	} = $props();

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

	let step = $state<0 | 2 | 3 | 4>(0);
	let part = $state<'address' | 'details'>('address');
	let terms = $state(false);
	let stage = $state(0);
	let paid = $state(preselected !== null);
	let fullName = $state('');
	let handle = $state('');
	const mailDomain = $derived(platformDomains.default);
	const address = $derived(`${handle}@${mailDomain}`);
	let pw = $state('');
	let confirm = $state('');
	let sel = $state<PlanSelection>(
		preselected ?? { product: 'personal', tier: null, seats: 3, period: preselectedPeriod }
	);

	let submitting = $state(false);
	let leaving = $state(false);
	let submitError = $state<string | null>(null);

	onDestroy(() => {
		pw = '';
		confirm = '';
	});

	let status = $state<'idle' | 'invalid' | 'checking' | 'taken' | 'available' | 'unknown'>('idle');
	const checking = delayed(() => status === 'checking');

	const proof = createProofOfWork();

	$effect(() => {
		if (step === 0 && part === 'details') untrack(() => proof.prepare(address));
	});

	$effect(() => () => proof.dispose());

	let suggestions = $state<string[]>([]);

	$effect(() => {
		const h = handle.trim().toLowerCase();
		suggestions = [];
		if (!h) {
			status = 'idle';
			return;
		}
		const valid = HANDLE_RE.test(h);
		status = valid ? 'checking' : 'idle';
		let cancelled = false;
		const timer = setTimeout(async () => {
			if (!valid) {
				status = 'invalid';
				return;
			}
			try {
				const { available } = await checkAddressAvailability(h, signupSession());
				if (cancelled) return;
				status = available ? 'available' : 'taken';
				if (!available) void suggest(h, () => cancelled);
			} catch {
				if (!cancelled) status = 'unknown';
			}
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	async function suggest(h: string, stale: () => boolean) {
		const candidates = handleSuggestions(h).filter((c) => HANDLE_RE.test(c));
		const results = await Promise.all(
			candidates.map((c) =>
				checkAddressAvailability(c, signupSession())
					.then((r) => r.available)
					.catch(() => false)
			)
		);
		if (stale()) return;
		suggestions = candidates.filter((_, i) => results[i]).slice(0, 3);
	}

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
	const pillTotal = $derived(paid ? 4 : 3);
	const product = $derived(findPlan(sel).product);
	const audience = $derived(paid ? product.id : 'personal');

	const heading = $derived.by(() => {
		if (audience === 'family') return m.auth_register_heading_family();
		if (audience === 'business') return m.auth_register_heading_business();
		return m.auth_register_heading_personal();
	});

	const nameReady = $derived(fullName.trim().length > 0 && fullName.trim().length <= 120);
	const domainReady = $derived(platformDomains.loaded && mailDomain.length > 0);
	const handleReady = $derived((status === 'available' || status === 'unknown') && domainReady);
	const addressReady = $derived(handleReady && nameReady);

	const allMet = $derived(passwordReqs(pw).every((r) => r.met));
	const matches = $derived(confirm.length > 0 && confirm === pw);
	const mismatch = $derived(confirm.length > 0 && confirm !== pw);
	const passwordReady = $derived(allMet && matches);
	const confirmBad = $derived(mismatch && !pw.startsWith(confirm));
	const handleTone = $derived(
		status === 'invalid' || status === 'taken'
			? 'bad'
			: checking.visible
				? 'busy'
				: status === 'available'
					? 'ok'
					: 'hint'
	);
	const confirmTone = $derived(submitError || confirmBad ? 'bad' : matches ? 'ok' : 'hint');
	const canCreate = $derived(addressReady && passwordReady && (paid || terms));
	const freeAddress = $derived(handle.trim() ? address : `yourname@${mailDomain}`);
	const workLines = $derived([m.auth_s_work_keys(), m.auth_s_work_account(), m.auth_s_work_open()]);

	function submitAddress(e: SubmitEvent) {
		e.preventDefault();
		if (handleReady) part = 'details';
	}

	function submitDetails(e: SubmitEvent) {
		e.preventDefault();
		continueFromPassword();
	}

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
		step = 0;
		part = 'details';
	}

	function continueFromPassword() {
		if (!canCreate) return;
		if (!paid) {
			void createFree();
			return;
		}
		step = planCodeFor(sel) ? 3 : 2;
	}

	async function registerAndLogin(): Promise<number | null> {
		const email = address;
		const password = pw;
		const plan = paid ? planCodeFor(sel) : null;
		stage = 0;
		try {
			const start = await keystore.opaqueStartRegistration({ email, password });
			const init = await withProofOfWork(proof, email, (payload) =>
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
			stage = 1;
			await register(
				{
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
				},
				signupSession()
			);
			endSignupSession();
			await keystore.opaqueFinalizeRegister({ operationId: start.operationId, accountId: init.accountId });
		} catch (err) {
			submitError = registerErrorMessage(err);
			submitting = false;
			return null;
		}
		stage = 2;
		try {
			const outcome = await performLogin({ email, password, rememberMe: remember });
			if (outcome.status !== 'complete') {
				throw new Error('unexpected two-factor challenge on a fresh account');
			}
			leaving = true;
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
		if (submitting || !canCreate) return;
		submitting = true;
		submitError = null;
		const slot = await registerAndLogin();
		if (slot === null) return;
		try {
			await afterRegister(slot);
		} catch {
			leaveToSignIn();
		}
	}

	function leaveToSignIn() {
		pw = '';
		confirm = '';
		leaving = false;
		submitting = false;
		step = 4;
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
			await checkout(slot, {
				planCode,
				interval: sel.period,
				seats: product.perMailbox ? sel.seats : undefined,
				workspaceType: product.id
			});
		} catch {
			leaveToSignIn();
		}
	}
</script>

<svelte:head>
	<title>{m.auth_register_page_title()}</title>
</svelte:head>
{#snippet freeButton(t: string)}
	<button type="button" class="linklike" disabled={submitting} onclick={chooseFree}>{t}</button>
{/snippet}
{#snippet domain(t: string)}<span class="mono">{t}</span>{/snippet}
{#snippet addressTag(_: string)}<span class="mono">{address}</span>{/snippet}
{#snippet signInLink(t: string)}<a href={signInHref}>{t}</a>{/snippet}
{#snippet terms_(t: string)}<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet privacy(t: string)}<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet freeFoot()}
	<p class="switch">
		<Rich text={m.auth_register_free_foot()} tags={{ free: freeButton }} />
	</p>
{/snippet}
{#snippet domainSuffix()}@{mailDomain}{/snippet}
{#snippet changeAddress()}<button type="button" class="aux" disabled={submitting} onclick={() => (part = 'address')}>{m.auth_login_change_email()}</button>{/snippet}
{#snippet freeSide()}
	<aside class="af-side" aria-label={m.auth_register_side_label()}>
		<h2>{m.auth_register_side_title()}</h2>
		<p class="plan"><b>{m.auth_plan_free_name()}</b><span>{m.auth_register_side_price()}</span></p>
		<ul>
			<li><Icon icon={faCheck} size={15} /><span><Rich text={m.auth_register_side_address({ address: freeAddress })} tags={{ b: domain }} /></span></li>
			<li><Icon icon={faCheck} size={15} /><span>{m.auth_register_side_storage()}</span></li>
			<li><Icon icon={faCheck} size={15} /><span>{m.auth_register_side_no_card()}</span></li>
			<li><Icon icon={faCheck} size={15} /><span>{m.auth_register_side_upgrade()}</span></li>
		</ul>
		<p class="af-fine">{m.auth_register_side_keys()}</p>
	</aside>
{/snippet}

{#if step === 0}
	{#if submitting || leaving}
		<div class="card-surface" aria-live="polite">
			<StepPills total={pillTotal} current={pillTotal - 1} fraction={leaving ? 1 : (stage + 1) / (workLines.length + 1)} />
			{#if leaving}<div class="af-done" in:unfold><DoneMark /></div>{/if}
			<div class="card-head">
				<h1>{leaving ? m.auth_register_ready_title() : m.auth_register_working_title()}</h1>
				<p><Rich text={m.auth_register_working_for({ address })} tags={{ b: domain }} /></p>
			</div>
			<WorkSteps lines={workLines} at={leaving ? workLines.length : stage} />
			{#if leaving}
				<div in:unfold><Status tone="ok">{m.auth_register_ready_line()}</Status></div>
			{:else}
				<p class="af-fine">{m.auth_s_work_note()}</p>
			{/if}
		</div>
	{:else if part === 'address'}
		<div class={paid ? '' : 'af-split'}>
			<form class="card-surface" novalidate onsubmit={submitAddress}>
				<StepPills total={pillTotal} current={0} />
				<div class="card-head">
					<h1>{heading}</h1>
					<p>
						{#if audience === 'family'}<Rich text={m.auth_register_lede_family({ domain: mailDomain })} tags={{ domain }} />
						{:else if audience === 'business'}<Rich text={m.auth_register_lede_business({ domain: mailDomain })} tags={{ domain }} />
						{:else}{m.auth_register_address_sub()}{/if}
					</p>
				</div>
				{#if addMode && auth.email}
					<p class="af-note" transition:unfold>{m.auth_s_add_note()}</p>
				{/if}
				<div class="form">
					<TextField
						id="register-handle"
						bind:value={handle}
						label={m.auth_register_username_label()}
						placeholder={m.auth_s_handle_placeholder()}
						mono
						maxlength={30}
						invalid={status === 'invalid' || status === 'taken'}
						describedby="register-handle-msg"
						focus
						normalize={(raw) => raw.toLowerCase().replace(/\s+/g, '')}
						suffix={domainReady ? domainSuffix : undefined}
					/>
				</div>
				<Status id="register-handle-msg" tone={handleTone} reserve>
					{#if status === 'invalid'}{m.auth_s_handle_invalid()}
					{:else if status === 'taken'}{suggestions.length > 0 ? m.auth_register_handle_taken_pick({ address }) : m.auth_s_handle_taken({ address })}
					{:else if checking.visible}{m.auth_register_handle_checking()}
					{:else if status === 'available'}{m.auth_s_handle_free({ address })}
					{:else if status === 'unknown'}<Rich text={m.auth_register_handle_available({ address })} tags={{ b: domain }} />
					{:else}{m.auth_register_handle_hint()}{/if}
				</Status>
				{#if status === 'taken' && suggestions.length > 0}
					<div class="af-chips" transition:unfold>
						{#each suggestions as s (s)}
							<button type="button" class="af-chip" onclick={() => (handle = s)}>{s}@{mailDomain}</button>
						{/each}
					</div>
				{/if}
				<Button type="submit" variant="primary" size="lg" block disabled={!handleReady}>{m.common_continue()}</Button>
				<p class="af-row"><Rich text={m.auth_register_have_account()} tags={{ link: signInLink }} /></p>
			</form>
			{#if !paid}{@render freeSide()}{/if}
		</div>
	{:else}
		<form class="card-surface" novalidate onsubmit={submitDetails}>
			<StepPills total={pillTotal} current={1} />
			<input class="af-hidden-user" type="email" value={address} autocomplete="username" readonly tabindex="-1" aria-hidden="true" />
			<div class="card-head">
				<h1>{m.auth_register_details_title()}</h1>
				<p><Rich text={m.auth_register_details_for({ address })} tags={{ b: domain }} /></p>
			</div>
			<div class="form">
				<TextField id="register-address" value={address} label={m.common_email_address()} mono readonly aux={changeAddress} />
				<div class="field">
					<TextField
						id="register-name"
						bind:value={fullName}
						label={m.auth_register_name_label()}
						autocomplete="name"
						maxlength={120}
						describedby="register-name-hint"
						focus
					/>
					<p class="af-fine" id="register-name-hint">{m.auth_s_name_hint()}</p>
				</div>
				<div class="field">
					<PasswordField id="register-password" label={m.common_password()} bind:value={pw} autocomplete="new-password" disabled={submitting} />
					<PasswordChecks {pw} />
				</div>
				<div class="field">
					<PasswordField
						id="register-confirm"
						label={m.auth_register_confirm_label()}
						bind:value={confirm}
						autocomplete="new-password"
						invalid={confirmBad}
						describedby="register-confirm-msg"
						disabled={submitting}
					/>
					<Status id="register-confirm-msg" tone={confirmTone} reserve>
						{#if submitError}{submitError}
						{:else if confirmBad}{m.auth_register_passwords_mismatch()}
						{:else if matches}{m.auth_register_passwords_match()}
						{:else}{m.auth_s_confirm_hint()}{/if}
					</Status>
				</div>
				{#if !paid}
					<label class="af-tick">
						<input type="checkbox" bind:checked={terms} />
						<span><Rich text={m.auth_payment_accept_terms()} tags={{ terms: terms_, privacy }} /></span>
					</label>
				{/if}
			</div>
			<Button type="submit" variant="primary" size="lg" block disabled={!canCreate}>
				{paid ? m.common_continue() : m.auth_s_create_account()}
			</Button>
			{#if paid}
				<p class="af-row"><button type="button" class="af-link" onclick={chooseFree}>{m.auth_register_free_instead()}</button></p>
				<p class="af-fine center">{m.auth_register_legal_paid()}</p>
			{:else}
				<p class="af-row"><button type="button" class="af-link" disabled={!passwordReady} onclick={choosePaid}>{m.auth_register_paid_instead()}</button></p>
				<p class="af-fine center">{m.auth_register_legal_free({ domains: platformDomains.display('conjunction') })}</p>
			{/if}
		</form>
	{/if}
{:else if step === 2}
	<PlanStep
		bind:sel
		{labels}
		busy={submitting}
		onBack={() => {
			step = 0;
			part = 'details';
		}}
		onNext={() => (step = 3)}
		footer={freeFoot}
	/>
{:else if step === 3}
	<PaymentStep
		{address}
		{sel}
		{labels}
		{submitting}
		error={submitError}
		onBack={() => (step = 2)}
		onChangePlan={() => (step = 2)}
		onPay={submitRegistration}
	/>
{:else}
	<div class="card-surface">
		<div class="card-head">
			<h1>{m.auth_register_submitted_title()}</h1>
			<p><Rich text={m.auth_s_submitted()} tags={{ address: addressTag }} /></p>
		</div>
		{#if planLabel}
			<p class="af-note ok">
				<Icon icon={faCircleCheck} size={15} />
				<span><Rich text={m.auth_register_plan_pending({ plan: planLabel })} tags={{ b: domain }} /></span>
			</p>
		{/if}
		<Button variant="primary" size="lg" block onclick={() => goto(signInHref)}>{m.auth_sign_in()}</Button>
	</div>
{/if}
