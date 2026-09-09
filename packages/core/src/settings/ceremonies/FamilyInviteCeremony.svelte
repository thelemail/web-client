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

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	const seatsTotal = $derived(seatLimitFor(workspaces.workspace?.type ?? null));
	const seatsUsed = $derived(workspaces.members.length + workspaces.invites.length);
	const seatsLeft = $derived(seatsTotal == null ? null : seatsTotal - seatsUsed);
	const familyName = $derived(workspaces.workspace?.name ?? 'your family');

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
		if (!looksLikeEmail) return `Enter a full address, like jules@${SHARED_DOMAIN}.`;
		if (!isSharedDomainAddress(trimmed)) {
			return `Family invitations only work with ${SHARED_DOMAIN} addresses.`;
		}
		if (auth.email && trimmed === auth.email.toLowerCase()) return 'That is your own address.';
		if (workspaces.members.some((m) => m.email.toLowerCase() === trimmed)) {
			return `${trimmed} is already in your family.`;
		}
		if (workspaces.invites.some((i) => i.email.toLowerCase() === trimmed)) {
			return `${trimmed} has already been invited. The invitation is still open.`;
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
	eyebrow="Household"
	title="Invite someone to {familyName}"
	steps={['Person', 'Invite']}
	step={step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					They need a Thelemail account already. Their address, their mail and their keys stay
					theirs. Joining moves them into your family so you can share a calendar.
				</p>
			</div>

			<div class="field">
				<label for="fam-inv-email">Their Thelemail address</label>
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
						Only free accounts on {SHARED_DOMAIN} can join a family.
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
					<b>Uses 1 of your {seatsTotal} seats.</b>
					{(seatsLeft ?? 0) - 1 >= 0 ? (seatsLeft ?? 0) - 1 + ' will remain' : 'none will remain'}.
					Nothing is charged.
				</div>
			</div>
		</div>
	{:else}
		<DoneScreen
			icon={UserCheck}
			title="Invitation sent"
			desc="{invited} has been invited. They accept from the link below, signed in to their own account."
		>
			<div class="invite-link">
				<div class="il-label">
					<Link size={14} />Invitation link <span class="il-note">expires in 7 days</span>
				</div>
				<div class="il-row">
					<code>{inviteLink ?? ''}</code>
					<CopyBtn text={inviteLink ?? ''} small label="Copy link" />
				</div>
			</div>

			<div class="cer-reminder">
				<MailCheck size={15} />Also sent to <b class="mono">{invited}</b>
			</div>
			<div class="cer-reminder">Nothing changes for them until they accept.</div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose} disabled={submitting}>Cancel</Button>
			<Button variant="primary" disabled={!ready || submitting} onclick={submit}>
				{submitting ? 'Sending…' : 'Send invitation'}<ArrowRight size={15} />
			</Button>
		{:else}
			<Button
				variant="primary"
				onclick={() => {
					onComplete('familyInvite');
					onClose();
				}}>Done</Button
			>
		{/if}
	{/snippet}
</CeremonyShell>
