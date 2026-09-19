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
	import { acceptFamilyInvite, type WorkspaceInvitePreview } from '$core/api/workspaces';
	import { acceptInviteError } from '$core/settings/family-invite-errors';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { reloadWorkspaceData } from '$core/stores/accountData';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

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
	const inviter = $derived(invite.inviterDisplayName?.trim() || m.auth_family_invite_someone());
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

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

{#if joined}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<CircleCheck size={28} />
			<h1>{m.auth_family_invite_joined_title({ workspace: invite.workspaceName })}</h1>
			<p>{m.auth_family_invite_joined_body()}</p>
		</div>
		<div class="actions" style="margin-top:24px">
			<Button variant="primary" size="lg" block onclick={() => goto(`/u/${landingSlot}/mail/inbox`)}>
				{m.auth_family_invite_open()}
			</Button>
		</div>
	</div>
{:else if !signedInAsInvitee}
	<div class="card-surface screen-fade">
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname">{m.auth_invite_invited_you({ inviter })}</span>
				<span class="isub"
					><Rich
						text={m.auth_invite_to_join({ workspace: invite.workspaceName })}
						tags={{ b: bold }}
					/></span
				>
			</span>
		</div>
		<div class="card-head">
			<h1>{m.auth_family_invite_wrong_account_title({ email: invite.inviteeEmail })}</h1>
			{#if auth.email}
				<p>
					{m.auth_family_invite_switch_account({
						current: auth.email,
						email: invite.inviteeEmail
					})}
				</p>
			{:else}
				<p>{m.auth_family_invite_sign_in_to_accept()}</p>
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
					{m.auth_family_invite_unlock({ email: invite.inviteeEmail })}
				</Button>
			{:else if accounts.list.length > 0}
				<Button
					variant="primary"
					size="lg"
					block
					onclick={() => goto(`/login?addAccount=1&redirect=${encodeURIComponent(redirect)}`)}
				>
					{m.auth_family_invite_add({ email: invite.inviteeEmail })}
				</Button>
			{:else}
				<Button
					variant="primary"
					size="lg"
					block
					onclick={() => goto(`/login?redirect=${encodeURIComponent(redirect)}`)}
				>
					{m.auth_family_invite_sign_in()}
				</Button>
			{/if}
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="invite">
			<span class="iav">{inviterInitials}</span>
			<span class="itext">
				<span class="iname">{m.auth_invite_invited_you({ inviter })}</span>
				<span class="isub"
					><Rich
						text={m.auth_invite_to_join({ workspace: invite.workspaceName })}
						tags={{ b: bold }}
					/></span
				>
			</span>
		</div>
		<div class="card-head">
			<h1>{m.auth_family_invite_join_title({ workspace: invite.workspaceName })}</h1>
			<p>{m.auth_family_invite_join_lede({ workspace: invite.workspaceName })}</p>
		</div>

		<ul class="terms">
			<li>
				<Inbox size={16} />
				<span>{m.auth_family_invite_term_keep({ email: invite.inviteeEmail })}</span>
			</li>
			<li>
				<CalendarDays size={16} />
				<span>{m.auth_family_invite_term_calendar()}</span>
			</li>
			<li>
				<Wallet size={16} />
				<span>{m.auth_family_invite_term_free()}</span>
			</li>
			<li class="caveat">
				<UserRound size={16} />
				<span>{m.auth_family_invite_term_privacy({ inviter })}</span>
			</li>
			<li class="caveat">
				<LogOut size={16} />
				<span>{m.auth_family_invite_term_dissolve()}</span>
			</li>
		</ul>

		{#if joinError}
			<div class="form-error" style="margin-top:16px">
				<CircleAlert size={15} />{joinError}
			</div>
		{/if}

		<div class="btnrow" style="margin-top:24px">
			<Button variant="ghost" size="lg" onclick={() => goto(`/u/${landingSlot}/mail/inbox`)}>
				{m.auth_family_invite_not_now()}
			</Button>
			<Button variant="primary" size="lg" disabled={joining} onclick={join}>
				{joining
					? m.auth_family_invite_joining()
					: m.auth_family_invite_join({ workspace: invite.workspaceName })}<ArrowRight size={16} />
			</Button>
		</div>
	</div>
{/if}

<style>
	.terms {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 6px 0 0;
		padding: 18px 0 0;
		border-top: var(--hairline);
		list-style: none;
	}
	.terms li {
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 10px;
		align-items: start;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--fg);
	}
	.terms li :global(svg) {
		margin-top: 2px;
		color: var(--pine-600);
	}
	.terms li.caveat {
		color: var(--fg-muted);
	}
	.terms li.caveat :global(svg) {
		color: var(--ink-400);
	}
</style>
