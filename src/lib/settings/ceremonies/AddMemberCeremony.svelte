<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Users from '@lucide/svelte/icons/users';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Info from '@lucide/svelte/icons/info';
	import Link from '@lucide/svelte/icons/link';
	import Send from '@lucide/svelte/icons/send';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import { browser } from '$app/environment';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import Select from '../Select.svelte';
	import CopyBtn from '../CopyBtn.svelte';
	import type { CeremonyKind } from '../data';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { customDomains } from '$lib/stores/customDomains.svelte';
	import { ownershipProven } from '$lib/settings/domains/steps';
	import { seatLimitFor } from '../plan-display';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	const wsType = $derived(workspaces.workspace?.type ?? null);
	const fam = $derived(wsType === 'family');
	const seatsTotal = $derived(seatLimitFor(wsType, billing.subscription?.seats ?? null));
	const seatsUsed = $derived(workspaces.members.length + workspaces.invites.length);
	const seatsLeft = $derived(seatsTotal != null ? seatsTotal - seatsUsed : null);

	const ownedDomains = $derived(customDomains.items.filter(ownershipProven));
	const domainNames = $derived(ownedDomains.map((d) => d.domain));

	const steps = $derived(['Person', fam ? 'Invite' : 'Seat & invite']);
	let step = $state(0);
	let name = $state('');
	let local = $state('');
	let customDomainId = $state<string>('');
	let email = $state('');
	let role = $state('Member');

	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let inviteLink = $state<string | null>(null);
	let sentToEmail = $state<string | null>(null);

	$effect(() => {
		if (ownedDomains.length === 0) {
			customDomainId = '';
			return;
		}
		if (!ownedDomains.some((d) => d.id === customDomainId)) {
			customDomainId = ownedDomains[0].id;
		}
	});

	const selectedDomain = $derived(
		ownedDomains.find((d) => d.id === customDomainId) ?? null
	);
	const selectedDomainName = $derived(selectedDomain?.domain ?? '');

	const nameOk = $derived(name.trim().length > 1);
	const localOk = $derived(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(local.trim()));
	const emailOk = $derived(
		email.trim() === '' || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())
	);
	const newAddr = $derived(
		(local.trim() || 'name') + '@' + (selectedDomainName || 'your-domain')
	);
	const newAddrNormalized = $derived(newAddr.toLowerCase());

	const memberConflict = $derived(
		!!local.trim() &&
			!!selectedDomainName &&
			workspaces.members.some((m) => m.email.toLowerCase() === newAddrNormalized)
	);
	const inviteConflict = $derived(
		!!local.trim() &&
			!!selectedDomainName &&
			workspaces.invites.some((i) => i.email.toLowerCase() === newAddrNormalized)
	);
	const addrConflict = $derived(memberConflict || inviteConflict);

	const hasDomain = $derived(ownedDomains.length > 0 && customDomainId !== '');
	const ready = $derived(nameOk && localOk && emailOk && hasDomain && !addrConflict);

	function selectDomainByName(name: string) {
		const match = ownedDomains.find((d) => d.domain === name);
		if (match) customDomainId = match.id;
	}

	async function submit() {
		if (!ready || submitting) return;
		submitting = true;
		submitError = null;
		try {
			const inviteRole = (fam ? 'member' : role.toLowerCase()) as 'admin' | 'member';
			const result = await workspaces.invite({
				customDomainId,
				localPart: local.trim().toLowerCase(),
				role: inviteRole
			});
			const base = browser ? window.location.origin.replace(/\/$/, '') : '';
			inviteLink = `${base}/invite/${result.token}`;
			sentToEmail = email.trim() || null;
			step = 1;
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Could not create invitation';
		} finally {
			submitting = false;
		}
	}
</script>

<CeremonyShell
	icon={fam ? UserPlus : Building2}
	eyebrow={fam ? 'Household' : 'Organization · seat'}
	title={fam ? 'Add a family member' : 'Add a member'}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					{fam
						? 'Add someone to your household. You choose their address; they set their own password — their mail is encrypted to them alone, even from you.'
						: 'Add a person to your organization. You choose their address and role; they set their own password. Their mail is encrypted to them alone.'}
				</p>
			</div>

			<div class="field">
				<label for="add-mem-name">Full name</label>
				<input
					id="add-mem-name"
					class="tin"
					bind:value={name}
					placeholder={fam ? 'Jules Thélème' : 'Camille Rondeau'}
					autocomplete="off"
				/>
			</div>

			<div class="field">
				<label for="add-mem-local">Address you’re giving them</label>
				<div class="alias-compose">
					<input
						id="add-mem-local"
						class="tin mono"
						bind:value={local}
						placeholder={fam ? 'jules' : 'camille'}
						autocomplete="off"
						disabled={!hasDomain}
					/>
					<span class="ac-at">@</span>
					{#if ownedDomains.length > 1}
						<Select
							value={selectedDomainName}
							options={domainNames}
							onChange={(v) => selectDomainByName(v)}
						/>
					{:else if ownedDomains.length === 1}
						<span class="ac-fixed mono">{selectedDomainName}</span>
					{:else}
						<span class="ac-fixed mono">—</span>
					{/if}
				</div>
				{#if ownedDomains.length === 0}
					<div class="field-hint bad">
						<CircleAlert size={13} />Add and verify a custom domain in Custom domains
						before inviting members.
					</div>
				{:else if local.length > 0 && !localOk}
					<div class="field-hint bad">
						<CircleAlert size={13} />Use letters, numbers, dots, or hyphens.
					</div>
				{:else if addrConflict}
					<div class="field-hint bad">
						<CircleAlert size={13} />Address already in use in this workspace.
					</div>
				{/if}
			</div>

			{#if !fam}
				<div class="field">
					<label for="add-mem-role">Role</label>
					<Select value={role} options={['Member', 'Admin']} onChange={(v) => (role = v)} />
					<div class="field-hint">
						<Info size={13} />
						{role === 'Admin'
							? 'Admins manage members, domains, and billing.'
							: 'Members manage only their own mailbox.'}
					</div>
				</div>
			{/if}

			<div class="field">
				<label for="add-mem-email">
					Send the invitation to <span class="lbl-opt">optional</span>
				</label>
				<input
					id="add-mem-email"
					class="tin mono"
					type="email"
					bind:value={email}
					placeholder="an existing email address"
					autocomplete="off"
				/>
				{#if email.length > 0 && !emailOk}
					<div class="field-hint bad">
						<CircleAlert size={13} />Enter a valid email address, or leave it blank.
					</div>
				{:else}
					<div class="field-hint">
						<Link size={13} />No email yet? Skip this — you’ll get a link to share instead.
					</div>
				{/if}
			</div>

			{#if submitError}
				<div class="field-hint bad" style="margin-top:8px">
					<CircleAlert size={13} />{submitError}
				</div>
			{/if}

			{#if fam}
				<div class="seat-callout ok">
					<Users size={17} />
					<div>
						<b>Uses 1 of your {seatsTotal} included seats.</b>
						{(seatsLeft ?? 0) - 1 >= 0
							? (seatsLeft ?? 0) - 1 + ' will remain'
							: 'none will remain'} — no additional charge.
					</div>
				</div>
			{:else}
				<div class="seat-callout">
					<Receipt size={17} />
					<div>
						<b>Adds 1 member to your workspace.</b>
						{(seatsLeft ?? 0) > 0
							? 'Uses one of your paid seats.'
							: 'Adds a prorated seat to your subscription when they join.'} You can remove the
						member anytime.
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={UserCheck}
			title="Member added"
			desc={'You’ve created the mailbox for ' +
				name.trim() +
				'. They’ll set their own password from the invitation, then it’s theirs alone.'}
		>
			<div class="done-pill">
				<b>{name.trim()}</b><span class="dp-sep">·</span><span class="mono">{newAddr}</span>
				{#if !fam}<span class="dp-tag">{role}</span>{/if}
			</div>

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
				{#if sentToEmail}
					<MailCheck size={15} />Invite also emailed to
					<b class="mono">{sentToEmail}</b>
				{:else}
					<Send size={15} />Share the link any way you like — no email required
				{/if}
			</div>

			{#if !fam}
				<div class="cer-reminder">
					<Receipt size={15} />Your workspace now has {seatsUsed + 1} members
				</div>
			{/if}
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<button type="button" class="btn btn-ghost" onclick={onClose} disabled={submitting}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={!ready || submitting}
				onclick={submit}
			>
				{submitting ? 'Creating invitation…' : 'Add member'}<ArrowRight size={15} />
			</button>
		{:else}
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => {
					onComplete('member');
					onClose();
				}}>Done</button
			>
		{/if}
	{/snippet}
</CeremonyShell>
