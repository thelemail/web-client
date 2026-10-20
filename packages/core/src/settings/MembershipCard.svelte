<script lang="ts">
	import UserRound from '@lucide/svelte/icons/user-round';
	import { platform } from '$platform';
	import Users from '@lucide/svelte/icons/users';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Info from '@lucide/svelte/icons/info';
	import Globe from '@lucide/svelte/icons/globe';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import Badge from './Badge.svelte';
	import Card from './Card.svelte';
	import MemberRow, { type MemberRowAction, type MemberRowFeedback } from './MemberRow.svelte';
	import { memberActionError } from './member-errors';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import SeatMeter from './SeatMeter.svelte';
	import type { CeremonyKind } from './data';
	import type { AccountMember } from './types';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { paletteFor } from '$core/mail/avatarPalette';
	import { billing } from '$core/stores/billing.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { usable } from '$core/settings/domains/steps';
	import { auth } from '$core/stores/auth.svelte';
	import {
		seatLimitFor,
		membershipTitle,
		addMemberLabel,
		seatsFullNote,
		personalNote
	} from './plan-display';
	import { inviteMode } from './entitlements';
	import { canResendInvite } from './addressModel';
	import LeaveFamilyDialog from './LeaveFamilyDialog.svelte';
	import RemoveMemberDialog from './RemoveMemberDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import { platformDomains } from '$core/stores/platformDomains.svelte';

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
	const seatsTotal = $derived(seatLimitFor(billing.plan, billing.subscription?.seats ?? null));
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
				role: wm.role
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
				role: inv.role,
				pending: true
			};
		})
	);

	const seatsUsed = $derived(people.length + pending.length);
	const planCode = $derived(billing.planCode);
	const mode = $derived(inviteMode(type, planCode));
	const isFreeFamily = $derived(billing.isFreeFamily);
	const seatUsage = $derived(
		type === 'business'
			? m.settings_member_seats_used_paid
			: isFreeFamily
				? m.settings_member_seats_used_free
				: m.settings_member_seats_used_included
	);
	const hasRoom = $derived(type === 'business' || seatsTotal === null || seatsUsed < seatsTotal);
	const usableDomainCount = $derived(customDomains.items.filter(usable).length);
	const mayInvite = $derived(
		mode !== 'none' &&
			workspaces.canInvite(callerAccountId, {
				required: mode === 'domain',
				verifiedCount: usableDomainCount
			})
	);
	const domainGated = $derived(mode === 'domain' && hasRoom && usableDomainCount === 0);
	const seatsLeft = $derived(seatsTotal == null ? null : seatsTotal - seatsUsed);
	const fullNote = $derived(seatsFullNote(type, seatsTotal, planCode));

	$effect(() => {
		void billing.ensureCatalog();
	});

	const myMember = $derived(workspaces.members.find((wm) => wm.accountId === callerAccountId) ?? null);
	const isWorkspaceOwner = $derived(myMember?.role === 'owner');
	const canLeave = $derived(isFreeFamily && !!myMember && !isWorkspaceOwner);

	let busyId = $state<string | null>(null);
	let leaving = $state(false);
	let removing = $state<{ accountId: string; name: string; email: string } | null>(null);
	let feedback = $state<(MemberRowFeedback & { addr: string }) | null>(null);

	function inviteLinkFor(token: string): string {
		return `${platform.returnOrigin().replace(/\/$/, '')}/invite/${token}`;
	}

	function lookupMemberByEmail(addr: string) {
		return workspaces.members.find((wm) => wm.email === addr) ?? null;
	}

	function lookupInviteByEmail(addr: string) {
		return workspaces.invites.find((wm) => wm.email === addr) ?? null;
	}

	function fail(p: AccountMember, action: MemberRowAction, err: unknown) {
		if (isReauthenticationRequired(err)) return;
		feedback = { addr: p.addr, kind: 'error', text: memberActionError(err, action.kind, p.name) };
	}

	async function copyInviteLink(p: AccountMember, link: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(link);
			return true;
		} catch {
			feedback = { addr: p.addr, kind: 'notice', text: m.settings_member_resend_copy_failed(), link };
			return false;
		}
	}

	async function handleAction(p: AccountMember, action: MemberRowAction): Promise<boolean> {
		feedback = null;
		const inv = lookupInviteByEmail(p.addr);
		if (inv && (action.kind === 'revoke' || action.kind === 'resend')) {
			busyId = inv.id;
			try {
				if (action.kind === 'revoke') {
					await workspaces.revokeInvite(inv.id);
					return true;
				}
				const result = await workspaces.resendInvite(inv.id);
				const link = inviteLinkFor(result.token);
				if (!(await copyInviteLink(p, link))) return false;
				feedback = { addr: p.addr, kind: 'notice', text: m.settings_member_link_copied() };
				return true;
			} catch (err) {
				fail(p, action, err);
				return false;
			} finally {
				busyId = null;
			}
		}
		const member = lookupMemberByEmail(p.addr);
		if (!member) return false;
		if (action.kind === 'remove' && isFreeFamily) {
			removing = { accountId: member.accountId, name: p.name, email: p.addr };
			return true;
		}
		busyId = member.accountId;
		try {
			if (action.kind === 'remove') {
				await workspaces.removeMember(member.accountId);
			} else if (action.kind === 'promote') {
				await workspaces.changeRole(member.accountId, 'admin');
			} else if (action.kind === 'demote') {
				await workspaces.changeRole(member.accountId, 'member');
			}
			return true;
		} catch (err) {
			fail(p, action, err);
			return false;
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
			canResend: !!inv && browser && canResendInvite(inv, customDomains.items),
			canPromote: !isPending && canManage && !isOwner && !isSelf && member?.role === 'member',
			canDemote: !isPending && canManage && !isOwner && !isSelf && member?.role === 'admin',
			canRemove: !isPending && !isOwner && canManage && !isSelf,
			busy:
				(member && busyId === member.accountId) || (inv && busyId === inv.id) ? true : false
		};
	}
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<Card id="members" tabindex={-1} icon={Icon} {title}>
	{#snippet right()}<Badge kind="pine">{workspaces.workspace?.name ?? ''}</Badge>{/snippet}

	{#if !isPersonal}
		<div class="seat-bar">
			{#if seatsTotal != null}
				<SeatMeter used={Math.min(seatsUsed, seatsTotal)} total={seatsTotal} />
				<span class="seat-text">
					<Rich text={seatUsage({ used: seatsUsed, total: seatsTotal })} tags={{ b: bold }} />{pending.length
						? ` · ${m.settings_member_pending_count({ count: pending.length })}`
						: ''}
				</span>
			{:else}
				<span class="seat-text">
					<Rich text={m.settings_member_active_seats({ count: people.length })} tags={{ b: bold }} />{pending.length
						? ` · ${m.settings_member_invited_count({ count: pending.length })}`
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
			feedback={feedback?.addr === p.addr ? feedback : null}
			onDismiss={() => (feedback = null)}
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
			feedback={feedback?.addr === p.addr ? feedback : null}
			onDismiss={() => (feedback = null)}
			onAction={(a) => handleAction(p, a)}
		/>
	{/each}

	<div class="mbr-foot">
		{#if isPersonal}
			<span class="mbr-note">{personalNote()}</span>
		{:else if mayInvite && hasRoom}
			<Button
				variant="secondary"
				size="sm"
				onclick={() => launch(mode === 'existing-account' ? 'familyInvite' : 'member')}
			>
				<UserPlus size={14} />{addLabel}
			</Button>
			{#if mode === 'existing-account'}
				{#if seatsTotal != null && seatsLeft != null}
					<span class="mbr-note">
						{m.settings_member_seats_free_existing({ left: seatsLeft, total: seatsTotal, domains: platformDomains.displayHosted() })}
					</span>
				{/if}
			{:else if seatsTotal != null}
				{#if type === 'business' && seatsUsed >= seatsTotal}
					<span class="mbr-note">{m.settings_member_seats_prorated()}</span>
				{:else if seatsTotal - seatsUsed > 0}
					<span class="mbr-note">
						{m.settings_member_seats_available({ left: seatsTotal - seatsUsed, total: seatsTotal })}
					</span>
				{/if}
			{/if}
		{:else if domainGated && canManage}
			<Button variant="secondary" size="sm" disabled>
				<UserPlus size={14} />{addLabel}
			</Button>
			<div class="seat-full">
				<Info size={15} />
				<span>{m.settings_member_domain_gate_manage()}</span>
			</div>
			<Button
				variant="secondary"
				size="sm"
				href={customDomains.items.length > 0 ? `/u/${slot}/settings/domains` : `/u/${slot}/settings/domains/new`}
			>
				<Globe size={14} />{customDomains.items.length > 0
					? m.settings_member_finish_domain()
					: m.settings_member_add_domain()}
			</Button>
		{:else if domainGated}
			<div class="seat-full">
				<Info size={15} />
				<span>{m.settings_member_domain_gate()}</span>
			</div>
		{:else if (!hasRoom || canManage) && fullNote}
			<div class="seat-full">
				<Info size={15} /><span>{fullNote}</span>
			</div>
		{/if}
		{#if canLeave}
			<Button variant="ghost" size="sm" onclick={() => (leaving = true)}>{m.settings_family_leave()}</Button>
		{/if}
	</div>
</Card>

{#if leaving}
	<LeaveFamilyDialog
		familyName={workspaces.workspace?.name ?? m.settings_family_this_family()}
		onClose={() => (leaving = false)}
	/>
{/if}

{#if removing}
	<RemoveMemberDialog
		name={removing.name}
		email={removing.email}
		accountId={removing.accountId}
		onClose={() => (removing = null)}
	/>
{/if}
