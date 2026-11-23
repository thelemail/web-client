<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { passwordReqs } from '$core/auth/password-policy';
	import Blank from '$core/auth/sentence/Blank.svelte';
	import Clause from '$core/auth/sentence/Clause.svelte';
	import Done from '$core/auth/sentence/Done.svelte';
	import Trail from '$core/auth/sentence/Trail.svelte';
	import PasswordChecks from '$core/auth/sentence/PasswordChecks.svelte';
	import WorkSteps from '$core/auth/sentence/WorkSteps.svelte';
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
	import Status from '$core/auth/sentence/Status.svelte';
	import Seal from '$core/auth/sentence/Seal.svelte';
	import { delayed } from '$core/async/delayed.svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faChevronDown, faCircleCheck } from '@fortawesome/pro-regular-svg-icons';
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
		checkout
	}: {
		afterRegister: (slot: number) => Promise<unknown>;
		checkout: (slot: number, order: RegisterCheckout) => Promise<unknown>;
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
	const PARTS = ['address', 'name', 'password', 'confirm'] as const;
	type Part = (typeof PARTS)[number];
	let part = $state<Part>('address');
	const partIndex = $derived(PARTS.indexOf(part));
	let terms = $state(false);
	let stage = $state(0);
	let paid = $state(preselected !== null);
	let fullName = $state('');
	let handle = $state('');
	let pickedDomain = $state<string | null>(null);
	const mailDomain = $derived(
		pickedDomain && platformDomains.offers(pickedDomain) ? pickedDomain : platformDomains.default
	);
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
		if (step === 0 && partIndex >= 2) untrack(() => proof.prepare(address));
	});

	$effect(() => () => proof.dispose());

	$effect(() => {
		const h = handle.trim().toLowerCase();
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
				if (!cancelled) status = available ? 'available' : 'taken';
			} catch {
				if (!cancelled) status = 'unknown';
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
	const trail = $derived(
		paid
			? [
					m.auth_step_address(),
					m.auth_step_account_name(),
					m.auth_step_password(),
					m.auth_step_confirm(),
					m.auth_step_plan(),
					m.auth_step_payment()
				]
			: [
					m.auth_step_address(),
					m.auth_step_account_name(),
					m.auth_step_password(),
					m.auth_step_confirm(),
					m.auth_step_recovery()
				]
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
	const workLines = $derived([m.auth_s_work_keys(), m.auth_s_work_account(), m.auth_s_work_open()]);

	function submitPart(e: SubmitEvent) {
		e.preventDefault();
		advance();
	}

	function advance() {
		if (part === 'address' && handleReady) part = 'name';
		else if (part === 'name' && nameReady) part = 'password';
		else if (part === 'password' && allMet) part = 'confirm';
		else if (part === 'confirm') continueFromPassword();
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
		part = 'confirm';
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
			const outcome = await performLogin({ email, password });
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
{#snippet signInLink(t: string)}<a href={signInHref}>{t}</a>{/snippet}
{#snippet terms_(t: string)}<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet privacy(t: string)}<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet freeFoot()}
	<p class="switch">
		<Rich text={m.auth_register_free_foot()} tags={{ free: freeButton }} />
	</p>
{/snippet}
{#snippet domainPick()}
	<span aria-hidden="true">@</span>{#if platformDomains.list.length > 1}<select
			aria-label={m.auth_register_domain_label()}
			value={mailDomain}
			onchange={(e) => (pickedDomain = e.currentTarget.value)}
		>
			{#each platformDomains.list as d (d)}
				<option value={d}>{d}</option>
			{/each}
		</select><Icon icon={faChevronDown} size={14} />{:else}{domainReady ? mailDomain : ''}{/if}
{/snippet}
{#snippet addressBlank(_: string)}<Blank
		id="register-handle"
		bind:value={handle}
		label={m.common_email_address()}
		placeholder={m.auth_s_handle_placeholder()}
		size={12}
		mono
		maxlength={30}
		invalid={status === 'invalid' || status === 'taken'}
		describedby="register-handle-msg"
		focus
		normalize={(raw) => raw.toLowerCase().replace(/\s+/g, '')}
		suffix={domainPick}
	/>{/snippet}
{#snippet addressDone(_: string)}<Done text={address} mono disabled={submitting} onedit={() => (part = 'address')} />{/snippet}
{#snippet nameBlank(_: string)}<Blank
		id="register-name"
		bind:value={fullName}
		label={m.auth_s_name_label()}
		placeholder={m.auth_s_name_placeholder()}
		size={14}
		autocomplete="nickname"
		maxlength={120}
		focus
	/>{/snippet}
{#snippet nameDone(_: string)}<Done text={fullName.trim()} disabled={submitting} onedit={() => (part = 'name')} />{/snippet}
{#snippet passwordBlank(_: string)}<Blank
		id="register-password"
		bind:value={pw}
		label={m.common_password()}
		placeholder={m.auth_s_new_password_placeholder()}
		size={14}
		mono
		secret
		autocomplete="new-password"
		focus
	/>{/snippet}
{#snippet passwordDone(_: string)}<Done text="" secret disabled={submitting} onedit={() => (part = 'password')} />{/snippet}
{#snippet confirmBlank(_: string)}<Blank
		id="register-confirm"
		bind:value={confirm}
		label={m.auth_register_confirm_label()}
		placeholder={m.auth_s_confirm_placeholder()}
		size={14}
		mono
		secret
		autocomplete="new-password"
		invalid={confirmBad}
		describedby="register-confirm-msg"
		disabled={submitting}
		focus
	/>{/snippet}
{#snippet addressFixed(_: string)}<Done text={address} mono />{/snippet}

{#if step === 0}
	<div class="sp">
		<Trail items={trail} current={submitting || leaving ? 3 : partIndex} />
		{#if submitting || leaving}
			{#if leaving}
				<p class="sent sm"><Clause text={m.auth_s_register_ready()} slots={{ address: addressFixed }} /></p>
			{:else}
				<p class="sent sm"><Clause text={m.auth_s_register_working()} slots={{ address: addressFixed }} /></p>
			{/if}
			<div class="sp-under">
				<WorkSteps lines={workLines} at={leaving ? 2 : stage} />
				{#if leaving}
					<Seal label={m.auth_s_seal_created()} />
				{:else}
					<p class="sp-fine">{m.auth_s_work_note()}</p>
				{/if}
			</div>
		{:else}
			<form class="sp-form" novalidate onsubmit={submitPart}>
				{#if partIndex >= 2}
					<input class="sp-user" type="email" value={address} autocomplete="username" readonly tabindex="-1" aria-hidden="true" />
				{/if}
				<p class="sent">
					<Clause
						text={m.auth_s_register_address()}
						past={partIndex > 0}
						slots={{ address: part === 'address' ? addressBlank : addressDone }}
					/>
					{#if partIndex >= 1}
						<Clause lead
							text={m.auth_s_register_name()}
							past={partIndex > 1}
							slots={{ name: part === 'name' ? nameBlank : nameDone }}
						/>
					{/if}
					{#if part === 'password'}
						<Clause lead text={m.auth_s_register_password()} slots={{ password: passwordBlank }} />
					{:else if part === 'confirm'}
						<Clause lead
							text={m.auth_s_register_password_again()}
							slots={{ password: passwordDone, confirm: confirmBlank }}
						/>
					{/if}
				</p>
				<div class="sp-under">
					{#if part === 'address'}
						{#if addMode && auth.email}
							<p class="sp-msg">{m.auth_s_add_note()}</p>
						{/if}
						{#if audience === 'family'}
							<p class="sp-msg"><span><Rich text={m.auth_register_lede_family({ domain: mailDomain })} tags={{ domain }} /></span></p>
						{:else if audience === 'business'}
							<p class="sp-msg"><span><Rich text={m.auth_register_lede_business({ domain: mailDomain })} tags={{ domain }} /></span></p>
						{/if}
						<Status id="register-handle-msg" tone={handleTone}>
							{#if status === 'invalid'}{m.auth_s_handle_invalid()}
							{:else if status === 'taken'}{m.auth_s_handle_taken({ address })}
							{:else if checking.visible}{m.auth_register_handle_checking()}
							{:else if status === 'available'}{m.auth_s_handle_free({ address })}
							{:else if status === 'unknown'}<Rich text={m.auth_register_handle_available({ address })} tags={{ b: domain }} />
							{:else}{m.auth_s_handle_hint()}{/if}
						</Status>
						<div class="sp-acts">
							<Button type="submit" variant="primary" size="lg" disabled={!handleReady}>{m.auth_sentence_next()}</Button>
						</div>
					{:else if part === 'name'}
						<Status>{m.auth_s_name_hint()}</Status>
						<div class="sp-acts">
							<Button type="submit" variant="primary" size="lg" disabled={!nameReady}>{m.auth_sentence_next()}</Button>
						</div>
					{:else if part === 'password'}
						<div class="sp-status-box"><PasswordChecks {pw} /></div>
						<div class="sp-acts">
							<Button type="submit" variant="primary" size="lg" disabled={!allMet}>{m.auth_sentence_next()}</Button>
						</div>
					{:else}
						<Status id="register-confirm-msg" tone={confirmTone}>
							{#if submitError}{submitError}
							{:else if confirmBad}{m.auth_register_passwords_mismatch()}
							{:else if matches}{m.auth_register_passwords_match()}
							{:else}{m.auth_s_confirm_hint()}{/if}
						</Status>
						{#if !paid}
							<label class="sp-tick">
								<input type="checkbox" bind:checked={terms} />
								<span><Rich text={m.auth_payment_accept_terms()} tags={{ terms: terms_, privacy }} /></span>
							</label>
						{/if}
						<div class="sp-acts">
							<Button type="submit" variant="primary" size="lg" disabled={!canCreate}>
								{paid ? m.common_continue() : m.auth_s_create_account()}
							</Button>
							{#if !paid}
								<span class="sp-fine">{m.auth_s_free_plan_line()}</span>
							{/if}
						</div>
						{#if paid}
							<button type="button" class="sp-quiet" onclick={chooseFree}>{m.auth_register_free_instead()}</button>
							<p class="sp-fine">{m.auth_register_legal_paid()}</p>
						{:else}
							<button type="button" class="sp-quiet" disabled={!passwordReady} onclick={choosePaid}>{m.auth_register_paid_instead()}</button>
							<p class="sp-fine">{m.auth_register_legal_free({ domains: platformDomains.display('conjunction') })}</p>
						{/if}
					{/if}
				</div>
			</form>
			<div class="sp-foot">
				<span><Rich text={m.auth_register_have_account()} tags={{ link: signInLink }} /></span>
			</div>
		{/if}
	</div>
{:else if step === 2}
	<PlanStep
		bind:sel
		{labels}
		busy={submitting}
		onBack={() => {
			step = 0;
			part = 'confirm';
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
	<div class="sp">
		<p class="sent sm"><Clause text={m.auth_s_submitted()} slots={{ address: addressFixed }} /></p>
		<div class="sp-under">
			{#if planLabel}
				<p class="sp-msg ok">
					<Icon icon={faCircleCheck} size={14} />
					<span><Rich text={m.auth_register_plan_pending({ plan: planLabel })} tags={{ b: domain }} /></span>
				</p>
			{/if}
			<div class="sp-acts">
				<Button variant="primary" size="lg" onclick={() => goto(signInHref)}>{m.auth_sign_in()}</Button>
			</div>
		</div>
	</div>
{/if}
