<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PasswordField from '$lib/auth/PasswordField.svelte';
	import Stepper from '$lib/auth/Stepper.svelte';
	import brandmark from '$lib/assets/logo-mark.svg';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Lock from '@lucide/svelte/icons/lock';
	import Mail from '@lucide/svelte/icons/mail';
	import { registrationInit } from '$lib/api/auth';
	import { previewWorkspaceInvite, registerAndAcceptInvite, type WorkspaceInvitePreview } from '$lib/api/workspaces';
	import { keystore } from '$lib/keystore/keystore-client';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';

	const STR_LABELS = ['', 'weak', 'fair', 'good', 'strong'];

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

	onMount(async () => {
		try {
			invite = await previewWorkspaceInvite(page.params.token ?? '');
		} catch (err) {
			previewError = err instanceof Error ? err.message : 'This invitation is no longer valid.';
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
		{ k: 'len', label: 'At least 8 characters', met: pw.length >= 8 },
		{ k: 'mix', label: 'Upper & lowercase letters', met: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
		{ k: 'num', label: 'A number or symbol', met: /\d/.test(pw) || /[^A-Za-z0-9]/.test(pw) }
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
			const init = await registrationInit({ email, registrationRequest: start.registrationRequest });
			const finish = await keystore.opaqueFinishRegistration({
				operationId: start.operationId,
				accountId: init.accountId,
				registrationResponse: init.registrationResponse
			});
			if (!finish.ok) {
				throw new Error('Could not prepare your mailbox keys. Please try again.');
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
				keyAlgorithm: finish.keyAlgorithm,
				enrollPersistentSession: false
			});

			const finalize = await keystore.opaqueFinalizeRegister({
				operationId: start.operationId,
				accountId: result.accountId
			});
			if (!finalize.ok) {
				throw new Error('Could not initialize local vault');
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
			submitError = err instanceof Error ? err.message : 'Registration failed';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Thelemail — Accept your invitation</title>
</svelte:head>

{#if previewLoading}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Verifying invitation</p>
			<h1>Just a moment…</h1>
		</div>
	</div>
{:else if previewError || !invite}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Invitation unavailable</p>
			<h1>This link can&rsquo;t be used</h1>
			<p>{previewError ?? 'The invitation may have expired, been revoked, or already been used.'}</p>
		</div>
		<div class="actions" style="margin-top:24px">
			<button class="btn btn-primary btn-block" onclick={() => goto('/login')}>Go to sign in</button>
		</div>
	</div>
{:else if step === 0}
	<div class="card-surface screen-fade">
		<Stepper step={0} labels={['Account', 'Password', 'Done']} />
		{#if auth.email}
			<div class="invite" style="background:var(--paper-100);border:1px solid var(--ink-200);border-radius:8px;padding:12px 14px;margin-bottom:14px">
				<span class="itext">
					<span class="iname">You're signed in as <b>{auth.email}</b></span>
					<span class="isub">
						Accepting this invitation will add the new account alongside your existing one — both
						stay signed in on this device.
					</span>
				</span>
			</div>
		{/if}
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname">{invite.inviterDisplayName || 'Someone'} invited you</span>
				<span class="isub">to join <b>{invite.workspaceName}</b> on Thelemail</span>
			</span>
		</div>
		<div class="card-head">
			<p class="eyebrow">Step 1 of 2</p>
			<h1>Set up your account</h1>
			<p>Your address has been created for you. Tell us your name to finish setting up.</p>
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="invite-email">Your email address</label></div>
				<div class="locked" id="invite-email">
					<span class="lval">{invite.inviteeEmail}</span>
					<span class="lk"><Lock size={13} strokeWidth={1.75} />Set by admin</span>
				</div>
				<span class="hint"
					>This address was assigned by your organization and can&rsquo;t be changed.</span
				>
			</div>
			<div class="field">
				<div class="lab"><label for="invite-name">Display name</label></div>
				<input
					id="invite-name"
					class="inp"
					bind:value={name}
					placeholder="e.g. Alex Renard"
					maxlength={64}
					autocomplete="name"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Enter' && nameReady) step = 1;
					}}
				/>
				<span class="hint">Shown to people you correspond with.</span>
			</div>
			<div class="actions">
				<button class="btn btn-primary btn-block" disabled={!nameReady} onclick={() => (step = 1)}>
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
		<Stepper step={1} labels={['Account', 'Password', 'Done']} />
		<div class="card-head">
			<p class="eyebrow">Step 2 of 2</p>
			<h1>Set a password</h1>
			<p>Securing <span class="mono" style="color:var(--ink-700)">{invite.inviteeEmail}</span></p>
		</div>
		<div class="form">
			<PasswordField
				label="Password"
				bind:value={pw}
				placeholder="Create a strong password"
				autocomplete="new-password"
			/>
			{#if pw}
				<div class="strength">
					<div class="strbar s{score}"><i></i><i></i><i></i><i></i></div>
					<div class="strlab s{score}">Strength: <b>{STR_LABELS[score]}</b></div>
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
				label="Confirm password"
				bind:value={confirm}
				placeholder="Re-enter password"
				autocomplete="new-password"
				onEnter={() => {
					if (passwordReady) submitRegistration();
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
			<label class="accept">
				<input type="checkbox" bind:checked={accepted} required />
				<span>
					I agree to the
					<a href="https://thelemail.com/terms" target="_blank" rel="noopener">Terms of Service</a>
					and
					<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
				</span>
			</label>
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
						disabled={!passwordReady || !accepted || submitting}
						onclick={submitRegistration}
					>
						{submitting ? 'Setting up your vault…' : 'Create account'}
					</button>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="welcome">
			<img class="brandmark brandmark-lg" src={brandmark} alt="Thelemail" />
			<h1>You&rsquo;re in</h1>
			<p>
				Welcome to {invite.workspaceName} on Thelemail. Your mailbox is provisioned and ready for its
				first letter.
			</p>
			<div class="addrcard">
				<span class="av">{initials}</span>
				<span class="em">{invite.inviteeEmail}</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			<div class="actions" style="margin-top:24px">
				<button
					class="btn btn-primary btn-block"
					onclick={() => goto(landingSlot !== null ? `/u/${landingSlot}/mail/inbox` : '/login')}
				>
					<Mail size={17} strokeWidth={1.75} />Enter Thelemail
				</button>
			</div>
		</div>
	</div>
{/if}
