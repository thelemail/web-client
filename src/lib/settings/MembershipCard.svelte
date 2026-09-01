<script lang="ts">
	import UserRound from '@lucide/svelte/icons/user-round';
	import { platform } from '$platform';
	import Users from '@lucide/svelte/icons/users';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Info from '@lucide/svelte/icons/info';
	import Globe from '@lucide/svelte/icons/globe';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Badge from './Badge.svelte';
	import CardHead from './CardHead.svelte';
	import MemberRow from './MemberRow.svelte';
	import SeatMeter from './SeatMeter.svelte';
	import type { CeremonyKind } from './data';
	import type { AccountMember } from './types';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { paletteFor } from '$lib/mail/avatarPalette';
	import { billing } from '$lib/stores/billing.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { ownershipProven } from '$lib/settings/domains/steps';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		seatLimitFor,
		isInvitable,
		membershipTitle,
		addMemberLabel,
		seatsFullNote,
		personalNote
	} from './plan-display';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	const slot = $derived(page.params.slot ?? '0');
	const type = $derived(workspaces.workspace?.type ?? null);
	const isPersonal = $derived(type === 'personal');
	const Icon = $derived(isPersonal ? UserRound : Users);
	const callerAccountId = $derived(auth.accountId);
	const canManage = $derived(workspaces.canManage(callerAccountId));
	const seatsTotal = $derived(seatLimitFor(type, billing.subscription?.seats ?? null));
	const title = $derived(membershipTitle(type));
	const addLabel = $derived(addMemberLabel(type));

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/);
		return (
			(parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
		).toUpperCase() || 'TH';
	}

	const people = $derived(
		workspaces.members.map<AccountMember>((wm) => {
			const c = paletteFor(wm.accountId);
			return {
				name: wm.fullName || wm.email,
				addr: wm.email,
				init: initials(wm.fullName || wm.email),
				bg: c.bg,
				fg: c.fg,
				role: wm.role[0]!.toUpperCase() + wm.role.slice(1)
			};
		})
	);

	const pending = $derived(
		workspaces.invites.map<AccountMember>((inv) => {
			const c = paletteFor(inv.id);
			return {
				name: inv.email,
				addr: inv.email,
				init: initials(inv.email.split('@')[0] ?? inv.email),
				bg: c.bg,
				fg: c.fg,
				role: inv.role[0]!.toUpperCase() + inv.role.slice(1),
				pending: true
			};
		})
	);

	const seatsUsed = $derived(people.length + pending.length);
	const seatNoun = $derived(type === 'business' ? 'paid seats used' : 'included seats used');
	const invitable = $derived(
		isInvitable(type) && (type === 'business' || seatsTotal === null || seatsUsed < seatsTotal)
	);
	const ownedDomainCount = $derived(customDomains.items.filter(ownershipProven).length);
	const domainGated = $derived(invitable && ownedDomainCount === 0);

	let busyId = $state<string | null>(null);

	function inviteLinkFor(token: string): string {
		return `${platform.returnOrigin().replace(/\/$/, '')}/invite/${token}`;
	}

	function lookupMemberByEmail(addr: string) {
		return workspaces.members.find((wm) => wm.email === addr) ?? null;
	}

	function lookupInviteByEmail(addr: string) {
		return workspaces.invites.find((wm) => wm.email === addr) ?? null;
	}

	async function handleAction(
		p: AccountMember,
		action: { kind: 'promote' | 'demote' | 'remove' | 'revoke' | 'resend' }
	) {
		const inv = lookupInviteByEmail(p.addr);
		if (inv && (action.kind === 'revoke' || action.kind === 'resend')) {
			busyId = inv.id;
			try {
				if (action.kind === 'revoke') {
					await workspaces.revokeInvite(inv.id);
				} else {
					const result = await workspaces.resendInvite(inv.id);
					await navigator.clipboard.writeText(inviteLinkFor(result.token));
				}
			} finally {
				busyId = null;
			}
			return;
		}
		const member = lookupMemberByEmail(p.addr);
		if (!member) return;
		busyId = member.accountId;
		try {
			if (action.kind === 'remove') {
				await workspaces.removeMember(member.accountId);
			} else if (action.kind === 'promote') {
				await workspaces.changeRole(member.accountId, 'admin');
			} else if (action.kind === 'demote') {
				await workspaces.changeRole(member.accountId, 'member');
			}
		} finally {
			busyId = null;
		}
	}

	function rowProps(p: AccountMember) {
		const isPending = !!p.pending;
		const inv = isPending ? lookupInviteByEmail(p.addr) : null;
		const member = !isPending ? lookupMemberByEmail(p.addr) : null;
		const isSelf = member?.accountId === callerAccountId;
		const isOwner = member?.role === 'owner';
		return {
			canRevoke: isPending && canManage,
			canResend: Boolean(inv) && browser,
			canPromote: !isPending && canManage && !isOwner && !isSelf && member?.role === 'member',
			canDemote: !isPending && canManage && !isOwner && !isSelf && member?.role === 'admin',
			canRemove: !isPending && !isOwner && canManage && !isSelf,
			busy:
				(member && busyId === member.accountId) || (inv && busyId === inv.id) ? true : false
		};
	}
</script>

<div class="scard">
	<CardHead icon={Icon} {title}>
		{#snippet right()}<Badge kind="pine">{workspaces.workspace?.name ?? ''}</Badge>{/snippet}
	</CardHead>

	{#if !isPersonal}
		<div class="seat-bar">
			{#if seatsTotal != null}
				<SeatMeter used={Math.min(seatsUsed, seatsTotal)} total={seatsTotal} />
				<span class="seat-text">
					<b>{seatsUsed}</b> of <b>{seatsTotal}</b>
					{seatNoun}{pending.length ? ` · ${pending.length} pending` : ''}
				</span>
			{:else}
				<span class="seat-text">
					<b>{people.length}</b> active seats{pending.length
						? ' · ' + pending.length + ' invited'
						: ''}
				</span>
			{/if}
		</div>
	{/if}

	{#each people as p (p.addr)}
		{@const rp = rowProps(p)}
		<MemberRow
			m={p}
			canPromote={rp.canPromote}
			canDemote={rp.canDemote}
			canRemove={rp.canRemove}
			canRevoke={rp.canRevoke}
			canResend={rp.canResend}
			busy={rp.busy}
			onAction={(a) => handleAction(p, a)}
		/>
	{/each}
	{#each pending as p (p.addr)}
		{@const rp = rowProps(p)}
		<MemberRow
			m={p}
			canPromote={rp.canPromote}
			canDemote={rp.canDemote}
			canRemove={rp.canRemove}
			canRevoke={rp.canRevoke}
			canResend={rp.canResend}
			busy={rp.busy}
			onAction={(a) => handleAction(p, a)}
		/>
	{/each}

	<div class="mbr-foot">
		{#if isPersonal}
			<span class="mbr-note">{personalNote()}</span>
		{:else if invitable && !domainGated}
			<button
				type="button"
				class="btn btn-secondary btn-sm"
				onclick={() => launch('member')}
			>
				<UserPlus size={14} />{addLabel}
			</button>
			{#if seatsTotal != null}
				{#if type === 'business' && seatsUsed >= seatsTotal}
					<span class="mbr-note">Inviting another member adds a prorated seat to your subscription.</span>
				{:else if seatsTotal - seatsUsed > 0}
					<span class="mbr-note">
						{seatsTotal - seatsUsed} of {seatsTotal} seats available
					</span>
				{/if}
			{/if}
		{:else if domainGated && canManage}
			<button type="button" class="btn btn-secondary btn-sm" disabled>
				<UserPlus size={14} />{addLabel}
			</button>
			<div class="seat-full">
				<Info size={15} />
				<span>Add a domain and prove you own it to invite members.</span>
			</div>
			<a class="btn btn-secondary btn-sm" href={`/u/${slot}/settings/domains/new`}>
				<Globe size={14} />Add a domain
			</a>
		{:else if domainGated}
			<div class="seat-full">
				<Info size={15} />
				<span>An admin must add a domain and prove ownership before members can be invited.</span>
			</div>
		{:else}
			<div class="seat-full">
				<Info size={15} /><span>{seatsFullNote(type, seatsTotal)}</span>
			</div>
		{/if}
	</div>
</div>
