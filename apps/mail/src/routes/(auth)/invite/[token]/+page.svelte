<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import Stepper from '$core/auth/Stepper.svelte';
	import brandmark from '$core/assets/logo-mark.svg';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Lock from '@lucide/svelte/icons/lock';
	import Mail from '@lucide/svelte/icons/mail';
	import { registrationInit } from '$core/api/auth';
	import { ApiCallError } from '$core/api/types';
	import { previewWorkspaceInvite, registerAndAcceptInvite, type WorkspaceInvitePreview } from '$core/api/workspaces';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import JoinFamilyInvite from '$core/auth/JoinFamilyInvite.svelte';
	import { createRegistrationProof, withRegistrationProof } from '$core/auth/registration-proof';
	import { Button } from '$core/components/ui/button';
	import { strengthLabel } from '$core/auth/password-policy';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const inviteLabels = $derived([m.auth_invite_step_account(), m.auth_step_password(), m.auth_step_done()]);

	let invite = $state<WorkspaceInvitePreview | null>(null);
	let previewError = $state<string | null>(null);
	let previewLoading = $state(true);

	const inviterInitials = $derived.by(() => {
		const n = invite?.inviterDisplayName?.trim();
		if (!n) return 'TH';
		return (
			n
				.split(/\s+/)
				.map((w) => w[0])
				.join('')
				.slice(0, 2)
				.toUpperCase() || 'TH'
		);
	});

	let step = $state<0 | 1 | 2>(0);
	let name = $state('');
	let pw = $state('');
	let confirm = $state('');
	let landingSlot = $state<number | null>(null);

	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let accepted = $state(false);

	const nameReady = $derived(name.trim().length >= 2);

	const proof = createRegistrationProof();

	$effect(() => {
		if (step === 1) untrack(() => proof.prepare());
	});

	$effect(() => () => proof.dispose());

	function inviteNotAcceptable(err: unknown): boolean {
		return err instanceof ApiCallError && err.envelope?.error?.code === 'invite_not_acceptable';
	}

	onMount(async () => {
		try {
			invite = await previewWorkspaceInvite(page.params.token ?? '');
		} catch (err) {
			previewError =
				inviteNotAcceptable(err) || !(err instanceof Error) ? m.auth_invite_no_longer_valid() : err.message;
		} finally {
			previewLoading = false;
		}
	});

	function scorePw(p: string): number {
		let s = 0;
		if (p.length >= 8) s++;
		if (p.length >= 12) s++;
		if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
		if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
		return Math.min(s, 4);
	}

	const score = $derived(pw ? scorePw(pw) : 0);
	const reqs = $derived([
		{ k: 'len', label: m.auth_password_req_length(), met: pw.length >= 8 },
		{
			k: 'mix',
			label: m.auth_password_req_mixed_case(),
			met: /[a-z]/.test(pw) && /[A-Z]/.test(pw)
		},
		{
			k: 'num',
			label: m.auth_password_req_number_symbol(),
			met: /\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)
		}
	]);
	const allMet = $derived(reqs.every((r) => r.met));
	const matches = $derived(confirm.length > 0 && confirm === pw);
	const mismatch = $derived(confirm.length > 0 && confirm !== pw);
	const passwordReady = $derived(allMet && matches);

	const initials = $derived(
		(name
			.trim()
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2) || 'th'
		).toUpperCase()
	);

	async function submitRegistration() {
		if (submitting || !passwordReady || !accepted || !invite) return;
		submitting = true;
		submitError = null;
		let password = pw;
		try {
			const email = invite.inviteeEmail;
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
			password = '';
			pw = '';
			confirm = '';
			const result = await registerAndAcceptInvite({
				token: page.params.token ?? '',
				email,
				fullName: name.trim(),
				registrationId: init.registrationId,
				opaqueRecord: finish.opaqueRecord,
				wrappedMasterKey: finish.wrappedMasterKey,
				masterKeyId: finish.masterKeyId,
				opaqueParamsVersion: finish.opaqueParamsVersion,
				publicKey: finish.publicKey,
				encryptedPrivateKey: finish.encryptedPrivateKey,
				enrollPersistentSession: false
			});

			const finalize = await keystore.opaqueFinalizeRegister({
				operationId: start.operationId,
				accountId: result.accountId
			});
			if (!finalize.ok) {
				throw new Error(m.auth_invite_vault_failed());
			}
			auth.setSession(result.accessToken, result.expiresInSeconds, result.accountId);
			await auth.loadProfile(result.accountId);
			await accounts.load();
			const existing = accounts.byId(result.accountId);
			const now = Date.now();
			let newSlot: number;
			if (existing) {
				newSlot = existing.slot;
				await accounts.upsert({ ...existing, email, lastActiveAt: now });
			} else {
				newSlot = accounts.allocateSlot();
				await accounts.upsert({
					accountId: result.accountId,
					slot: newSlot,
					email,
					addedAt: now,
					lastActiveAt: now
				});
			}
			landingSlot = newSlot;
			step = 2;
		} catch (err) {
			password = '';
			submitError = inviteNotAcceptable(err)
				? m.auth_invite_unavailable_body()
				: err instanceof Error
					? err.message
					: m.auth_register_failed();
		} finally {
			submitting = false;
		}
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet addr(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet signInLink(t: string)}<a href="/login">{t}</a>{/snippet}
{#snippet terms(t: string)}<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet privacy(t: string)}<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{t}</a>{/snippet}

<svelte:head>
	<title>{m.auth_invite_page_title()}</title>
</svelte:head>

{#if previewLoading}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.auth_invite_verifying_eyebrow()}</p>
			<h1>{m.auth_invite_verifying_title()}</h1>
		</div>
	</div>
{:else if previewError || !invite}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.auth_invite_unavailable_eyebrow()}</p>
			<h1>{m.auth_invite_unavailable_title()}</h1>
			<p>{previewError ?? m.auth_invite_unavailable_body()}</p>
		</div>
		<div class="actions" style="margin-top:24px">
			<Button variant="primary" size="lg" block onclick={() => goto('/login')}>{m.auth_invite_go_to_sign_in()}</Button>
		</div>
	</div>
{:else if invite.kind === 'join'}
	<JoinFamilyInvite {invite} token={page.params.token ?? ''} />
{:else if step === 0}
	<div class="card-surface screen-fade">
		<Stepper step={0} labels={inviteLabels} />
		{#if auth.email}
			<div class="invite" style="background:var(--paper-100);border:1px solid var(--ink-200);border-radius:8px;padding:12px 14px;margin-bottom:14px">
				<span class="itext">
					<span class="iname"
						><Rich text={m.auth_invite_signed_in_as({ email: auth.email })} tags={{ b: bold }} /></span
					>
					<span class="isub">{m.auth_invite_add_alongside()}</span>
				</span>
			</div>
		{/if}
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname"
					>{m.auth_invite_invited_you({
						inviter: invite.inviterDisplayName || m.auth_family_invite_someone()
					})}</span
				>
				<span class="isub"
					><Rich
						text={m.auth_invite_to_join({ workspace: invite.workspaceName })}
						tags={{ b: bold }}
					/></span
				>
			</span>
		</div>
		<div class="card-head">
			<p class="eyebrow">{m.auth_step_of({ step: 1, total: 2 })}</p>
			<h1>{m.auth_invite_setup_title()}</h1>
			<p>{m.auth_invite_setup_lede()}</p>
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="invite-email">{m.auth_invite_email_label()}</label></div>
				<div class="locked" id="invite-email">
					<span class="lval">{invite.inviteeEmail}</span>
					<span class="lk"><Lock size={13} strokeWidth={1.75} />{m.auth_invite_set_by_admin()}</span>
				</div>
				<span class="hint">{m.auth_invite_email_hint()}</span>
			</div>
			<div class="field">
				<div class="lab"><label for="invite-name">{m.auth_invite_name_label()}</label></div>
				<input
					id="invite-name"
					class="inp"
					bind:value={name}
					placeholder={m.auth_invite_name_placeholder()}
					maxlength={64}
					autocomplete="name"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Enter' && nameReady) step = 1;
					}}
				/>
				<span class="hint">{m.auth_invite_name_hint()}</span>
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={!nameReady} onclick={() => (step = 1)}>
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
		<Stepper step={1} labels={inviteLabels} />
		<div class="card-head">
			<p class="eyebrow">{m.auth_step_of({ step: 2, total: 2 })}</p>
			<h1>{m.auth_register_password_title()}</h1>
			<p>
				<Rich
					text={m.auth_register_password_securing({ address: invite.inviteeEmail })}
					tags={{ addr }}
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
			{#if pw}
				<div class="strength">
					<div class="strbar s{score}"><i></i><i></i><i></i><i></i></div>
					<div class="strlab s{score}">
						<Rich text={m.auth_password_strength({ label: strengthLabel(score) })} tags={{ b: bold }} />
					</div>
				</div>
			{/if}
			<div class="reqs">
				{#each reqs as r (r.k)}
					<div class="req" class:met={r.met}>
						<span class="rk">
							{#if r.met}
								<Check size={11} strokeWidth={2.5} />
							{:else}
								<Minus size={11} strokeWidth={2.5} />
							{/if}
						</span>
						{r.label}
					</div>
				{/each}
			</div>
			<PasswordField
				label={m.auth_register_confirm_label()}
				bind:value={confirm}
				placeholder={m.auth_register_confirm_placeholder()}
				autocomplete="new-password"
				onEnter={() => {
					if (passwordReady) submitRegistration();
				}}
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
			<label class="accept">
				<input type="checkbox" bind:checked={accepted} required />
				<span><Rich text={m.auth_payment_accept_terms()} tags={{ terms, privacy }} /></span>
			</label>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} disabled={submitting} onclick={() => (step = 0)}>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</Button>
					<Button variant="primary" size="lg" disabled={!passwordReady || !accepted || submitting} onclick={submitRegistration}>
						{submitting ? m.auth_invite_setting_up() : m.auth_invite_create_account()}
					</Button>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="welcome">
			<img class="brandmark brandmark-lg" src={brandmark} alt="Thelemail" />
			<h1>{m.auth_invite_done_title()}</h1>
			<p>{m.auth_invite_done_body({ workspace: invite.workspaceName })}</p>
			<div class="addrcard">
				<span class="av">{initials}</span>
				<span class="em">{invite.inviteeEmail}</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			<div class="actions" style="margin-top:24px">
				<Button variant="primary" size="lg" block onclick={() => goto(landingSlot !== null ? `/u/${landingSlot}/mail/inbox` : '/login')}>
					<Mail size={17} strokeWidth={1.75} />{m.auth_invite_enter()}
				</Button>
			</div>
		</div>
	</div>
{/if}
