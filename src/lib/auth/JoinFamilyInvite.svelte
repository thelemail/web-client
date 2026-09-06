<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Wallet from '@lucide/svelte/icons/wallet';
	import { acceptFamilyInvite, type WorkspaceInvitePreview } from '$lib/api/workspaces';
	import { acceptInviteError } from '$lib/settings/family-invite-errors';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { reloadWorkspaceData } from '$lib/stores/accountData';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		invite: WorkspaceInvitePreview;
		token: string;
	}

	let { invite, token }: Props = $props();

	let joining = $state(false);
	let joinError = $state<string | null>(null);
	let joined = $state(false);

	const inviteeEmail = $derived(invite.inviteeEmail.toLowerCase());
	const localRecord = $derived(
		accounts.list.find((r) => r.email.toLowerCase() === inviteeEmail) ?? null
	);
	const signedInAsInvitee = $derived(
		!!localRecord && auth.accountId === localRecord.accountId && !!auth.email
	);
	const landingSlot = $derived(localRecord?.slot ?? 0);
	const inviter = $derived(invite.inviterDisplayName?.trim() || 'Someone');
	const redirect = $derived(`/invite/${token}`);

	const inviterInitials = $derived.by(() => {
		const n = invite.inviterDisplayName?.trim();
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

	async function join() {
		if (joining) return;
		joining = true;
		joinError = null;
		try {
			await acceptFamilyInvite(token);
			if (auth.accountId) await reloadWorkspaceData(auth.accountId);
			joined = true;
		} catch (err) {
			joinError = acceptInviteError(err, inviter);
		} finally {
			joining = false;
		}
	}
</script>

{#if joined}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<CircleCheck size={28} />
			<h1>You are in {invite.workspaceName}</h1>
			<p>
				Your mailbox is unchanged. The family's shared calendar shows up in your calendar list.
			</p>
		</div>
		<div class="actions" style="margin-top:24px">
			<Button variant="primary" size="lg" block onclick={() => goto(`/u/${landingSlot}/mail/inbox`)}>
				Open Thelemail
			</Button>
		</div>
	</div>
{:else if !signedInAsInvitee}
	<div class="card-surface screen-fade">
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname">{inviter} invited you</span>
				<span class="isub">to join <b>{invite.workspaceName}</b> on Thelemail</span>
			</span>
		</div>
		<div class="card-head">
			<h1>This invitation is for {invite.inviteeEmail}</h1>
			{#if auth.email}
				<p>You are signed in as {auth.email}. Switch to {invite.inviteeEmail} to accept it.</p>
			{:else}
				<p>Sign in to that account to accept it.</p>
			{/if}
		</div>
		<div class="actions" style="margin-top:24px">
			{#if localRecord}
				<Button
					variant="primary"
					size="lg"
					block
					onclick={() => goto(`/login?slot=${localRecord.slot}&redirect=${encodeURIComponent(redirect)}`)}
				>
					Unlock {invite.inviteeEmail}
				</Button>
			{:else if accounts.list.length > 0}
				<Button
					variant="primary"
					size="lg"
					block
					onclick={() => goto(`/login?addAccount=1&redirect=${encodeURIComponent(redirect)}`)}
				>
					Add {invite.inviteeEmail}
				</Button>
			{:else}
				<Button
					variant="primary"
					size="lg"
					block
					onclick={() => goto(`/login?redirect=${encodeURIComponent(redirect)}`)}
				>
					Sign in
				</Button>
			{/if}
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname">{inviter} invited you</span>
				<span class="isub">to join <b>{invite.workspaceName}</b> on Thelemail</span>
			</span>
		</div>
		<div class="card-head">
			<h1>Join {invite.workspaceName}</h1>
			<p>Accepting moves your account into {invite.workspaceName}. Here is what that means.</p>
		</div>

		<ul class="reqs" style="margin-top:16px">
			<li class="req met">
				<Inbox size={15} />
				<span>You keep {invite.inviteeEmail}, every message in it, your keys and your calendars.</span>
			</li>
			<li class="req met">
				<CalendarDays size={15} />
				<span>You get the family's shared calendar.</span>
			</li>
			<li class="req met">
				<Wallet size={15} />
				<span>Your plan stays free. Nothing is charged, now or later.</span>
			</li>
			<li class="req">
				<UserRound size={15} />
				<span>
					{inviter} cannot read your mail. They can see who is in the family and can remove you.
				</span>
			</li>
			<li class="req">
				<LogOut size={15} />
				<span>
					Your own workspace is dissolved, so you cannot add a domain or invite anyone while you
					are in the family. You can leave at any time and get your workspace back.
				</span>
			</li>
		</ul>

		{#if joinError}
			<div class="form-error" style="margin-top:16px">
				<CircleAlert size={15} />{joinError}
			</div>
		{/if}

		<div class="actions" style="margin-top:24px">
			<Button variant="ghost" size="lg" onclick={() => goto(`/u/${landingSlot}/mail/inbox`)}>
				Not now
			</Button>
			<Button variant="primary" size="lg" disabled={joining} onclick={join}>
				{joining ? 'Joining…' : `Join ${invite.workspaceName}`}<ArrowRight size={16} />
			</Button>
		</div>
	</div>
{/if}
