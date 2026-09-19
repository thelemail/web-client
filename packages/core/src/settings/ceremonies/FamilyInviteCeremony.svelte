<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Link from '@lucide/svelte/icons/link';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import { platform } from '$platform';
	import CeremonyShell from '../CeremonyShell.svelte';
	import CopyBtn from '../CopyBtn.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import type { CeremonyKind } from '../data';
	import { SHARED_DOMAIN, isSharedDomainAddress } from '../entitlements';
	import { familyInviteError } from '../family-invite-errors';
	import { seatLimitFor } from '../plan-display';
	import { auth } from '$core/stores/auth.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	const seatsTotal = $derived(seatLimitFor(workspaces.workspace?.type ?? null));
	const seatsUsed = $derived(workspaces.members.length + workspaces.invites.length);
	const seatsLeft = $derived(seatsTotal == null ? null : seatsTotal - seatsUsed);
	const familyName = $derived(workspaces.workspace?.name ?? m.settings_ceremony_family_invite_family_fallback());

	let step = $state(0);
	let email = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let inviteLink = $state<string | null>(null);
	let invited = $state('');

	const trimmed = $derived(email.trim().toLowerCase());
	const looksLikeEmail = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed));

	const localProblem = $derived.by((): string | null => {
		if (trimmed.length === 0) return null;
		if (!looksLikeEmail) return m.settings_ceremony_family_invite_err_full_address({ domain: SHARED_DOMAIN });
		if (!isSharedDomainAddress(trimmed)) {
			return m.settings_ceremony_family_invite_err_shared_only({ domain: SHARED_DOMAIN });
		}
		if (auth.email && trimmed === auth.email.toLowerCase()) return m.settings_ceremony_family_invite_err_own();
		if (workspaces.members.some((m) => m.email.toLowerCase() === trimmed)) {
			return m.settings_ceremony_family_invite_err_member({ email: trimmed });
		}
		if (workspaces.invites.some((i) => i.email.toLowerCase() === trimmed)) {
			return m.settings_ceremony_family_invite_err_invited({ email: trimmed });
		}
		return null;
	});

	const ready = $derived(trimmed.length > 0 && localProblem === null);

	function inviteLinkFor(token: string): string {
		return `${platform.returnOrigin().replace(/\/$/, '')}/invite/${token}`;
	}

	async function submit() {
		if (!ready || submitting) return;
		submitting = true;
		submitError = null;
		try {
			const result = await workspaces.inviteExisting({ email: trimmed });
			inviteLink = inviteLinkFor(result.token);
			invited = trimmed;
			step = 1;
		} catch (err) {
			submitError = familyInviteError(err, trimmed);
		} finally {
			submitting = false;
		}
	}
</script>

<CeremonyShell
	icon={UserPlus}
	eyebrow={m.settings_ceremony_family_eyebrow()}
	title={m.settings_ceremony_family_invite_title({ family: familyName })}
	steps={[m.settings_ceremony_family_invite_step_person(), m.settings_ceremony_family_invite_step_invite()]}
	step={step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>{m.settings_ceremony_family_invite_lede()}</p>
			</div>

			<div class="field">
				<label for="fam-inv-email">{m.settings_ceremony_family_invite_email_label()}</label>
				<input
					id="fam-inv-email"
					class="tin mono"
					type="email"
					bind:value={email}
					placeholder="jules@{SHARED_DOMAIN}"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
				/>
				{#if localProblem}
					<div class="field-hint bad"><CircleAlert size={13} />{localProblem}</div>
				{:else}
					<div class="field-hint">
						{m.settings_ceremony_family_invite_email_hint({ domain: SHARED_DOMAIN })}
					</div>
				{/if}
			</div>

			{#if submitError}
				<div class="field-hint bad" style="margin-top:8px">
					<CircleAlert size={13} />{submitError}
				</div>
			{/if}

			<div class="seat-callout ok">
				<Users size={17} />
				<div>
					<b>{m.settings_ceremony_family_invite_seat_uses({ total: seatsTotal ?? '' })}</b>
					{(seatsLeft ?? 0) - 1 >= 0
						? m.settings_ceremony_family_invite_seat_remain({ count: (seatsLeft ?? 0) - 1 })
						: m.settings_ceremony_family_invite_seat_none_remain()}
					{m.settings_ceremony_family_invite_not_charged()}
				</div>
			</div>
		</div>
	{:else}
		<DoneScreen
			icon={UserCheck}
			title={m.settings_ceremony_family_invite_done_title()}
			desc={m.settings_ceremony_family_invite_done_desc({ email: invited })}
		>
			<div class="invite-link">
				<div class="il-label">
					<Link size={14} />{m.settings_ceremony_family_invite_link_label()}
					<span class="il-note">{m.settings_ceremony_family_invite_link_expiry()}</span>
				</div>
				<div class="il-row">
					<code>{inviteLink ?? ''}</code>
					<CopyBtn text={inviteLink ?? ''} small label={m.settings_ceremony_family_invite_copy_link()} />
				</div>
			</div>

			<div class="cer-reminder">
				<MailCheck size={15} /><Rich
					text={m.settings_ceremony_family_invite_also_sent({ email: invited })}
					tags={{ b: mono }}
				/>
			</div>
			<div class="cer-reminder">{m.settings_ceremony_family_invite_nothing_changes()}</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose} disabled={submitting}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!ready || submitting} onclick={submit}>
				{submitting
					? m.settings_ceremony_family_invite_sending()
					: m.settings_ceremony_family_invite_submit()}<ArrowRight size={15} />
			</Button>
		{:else}
			<Button
				variant="primary"
				onclick={() => {
					onComplete('familyInvite');
					onClose();
				}}>{m.common_done()}</Button
			>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet mono(t: string)}<b class="mono">{t}</b>{/snippet}
