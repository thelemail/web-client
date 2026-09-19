<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { platform } from '$platform';
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
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { ownershipProven } from '$core/settings/domains/steps';
	import { seatLimitFor } from '../plan-display';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

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

	const steps = $derived([
		m.settings_ceremony_member_step_person(),
		fam ? m.settings_ceremony_member_step_invite() : m.settings_ceremony_member_step_seat_invite()
	]);
	let step = $state(0);
	let name = $state('');
	let local = $state('');
	let customDomainId = $state<string>('');
	let email = $state('');
	let role = $state('Member');
	const roleOptions = $derived([
		{ v: 'Member', l: m.settings_ceremony_member_role_member() },
		{ v: 'Admin', l: m.settings_ceremony_member_role_admin() }
	]);
	const roleLabel = $derived(roleOptions.find((o) => o.v === role)?.l ?? role);

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
			const deliverTo = email.trim();
			const result = await workspaces.invite({
				customDomainId,
				localPart: local.trim().toLowerCase(),
				role: inviteRole,
				deliverTo: deliverTo || undefined
			});
			const base = browser ? platform.returnOrigin().replace(/\/$/, '') : '';
			inviteLink = `${base}/invite/${result.token}`;
			sentToEmail = result.invite.deliverTo ?? null;
			step = 1;
		} catch (err) {
			submitError = err instanceof Error ? err.message : m.settings_ceremony_member_error();
		} finally {
			submitting = false;
		}
	}
</script>

<CeremonyShell
	icon={fam ? UserPlus : Building2}
	eyebrow={fam ? m.settings_ceremony_member_eyebrow_family() : m.settings_ceremony_member_eyebrow_org()}
	title={fam ? m.settings_ceremony_member_title_family() : m.settings_ceremony_member_title_org()}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					{fam
						? m.settings_ceremony_member_lede_family()
						: m.settings_ceremony_member_lede_org()}
				</p>
			</div>

			<div class="field">
				<label for="add-mem-name">{m.settings_ceremony_member_name_label()}</label>
				<input
					id="add-mem-name"
					class="tin"
					bind:value={name}
					placeholder={fam
						? m.settings_ceremony_member_name_placeholder_family()
						: m.settings_ceremony_member_name_placeholder_org()}
					autocomplete="off"
				/>
			</div>

			<div class="field">
				<label for="add-mem-local">{m.settings_ceremony_member_address_label()}</label>
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
						<CircleAlert size={13} />{m.settings_ceremony_member_no_domain()}
					</div>
				{:else if local.length > 0 && !localOk}
					<div class="field-hint bad">
						<CircleAlert size={13} />{m.settings_ceremony_member_local_invalid()}
					</div>
				{:else if addrConflict}
					<div class="field-hint bad">
						<CircleAlert size={13} />{m.settings_ceremony_member_address_conflict()}
					</div>
				{/if}
			</div>

			{#if !fam}
				<div class="field">
					<label for="add-mem-role">{m.settings_ceremony_member_role_label()}</label>
					<Select value={role} options={roleOptions} onChange={(v) => (role = v)} />
					<div class="field-hint">
						<Info size={13} />
						{role === 'Admin'
							? m.settings_ceremony_member_role_admin_hint()
							: m.settings_ceremony_member_role_member_hint()}
					</div>
				</div>
			{/if}

			<div class="field">
				<label for="add-mem-email">
					{m.settings_ceremony_member_send_to_label()}
					<span class="lbl-opt">{m.settings_ceremony_member_optional()}</span>
				</label>
				<input
					id="add-mem-email"
					class="tin mono"
					type="email"
					bind:value={email}
					placeholder={m.settings_ceremony_member_email_placeholder()}
					autocomplete="off"
				/>
				{#if email.length > 0 && !emailOk}
					<div class="field-hint bad">
						<CircleAlert size={13} />{m.settings_ceremony_member_email_invalid()}
					</div>
				{:else}
					<div class="field-hint">
						<Link size={13} />{m.settings_ceremony_member_email_hint()}
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
						<b>{m.settings_ceremony_member_seat_uses_family({ total: seatsTotal ?? '' })}</b>
						{(seatsLeft ?? 0) - 1 >= 0
							? m.settings_ceremony_member_seat_remain_family({ count: (seatsLeft ?? 0) - 1 })
							: m.settings_ceremony_member_seat_none_remain_family()}
					</div>
				</div>
			{:else}
				<div class="seat-callout">
					<Receipt size={17} />
					<div>
						<b>{m.settings_ceremony_member_seat_adds_org()}</b>
						{(seatsLeft ?? 0) > 0
							? m.settings_ceremony_member_seat_paid_org()
							: m.settings_ceremony_member_seat_prorated_org()}
						{m.settings_ceremony_member_seat_remove_org()}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={UserCheck}
			title={m.settings_ceremony_member_done_title()}
			desc={m.settings_ceremony_member_done_desc({ name: name.trim() })}
		>
			<div class="done-pill">
				<b>{name.trim()}</b><span class="dp-sep">·</span><span class="mono">{newAddr}</span>
				{#if !fam}<span class="dp-tag">{roleLabel}</span>{/if}
			</div>

			<div class="invite-link">
				<div class="il-label">
					<Link size={14} />{m.settings_ceremony_member_link_label()}
					<span class="il-note">{m.settings_ceremony_member_link_expiry()}</span>
				</div>
				<div class="il-row">
					<code>{inviteLink ?? ''}</code>
					<CopyBtn text={inviteLink ?? ''} small label={m.settings_ceremony_member_copy_link()} />
				</div>
			</div>

			<div class="cer-reminder">
				{#if sentToEmail}
					<MailCheck size={15} /><Rich
						text={m.settings_ceremony_member_emailed_to({ email: sentToEmail })}
						tags={{ b: mono }}
					/>
				{:else}
					<Send size={15} />{m.settings_ceremony_member_share_link()}
				{/if}
			</div>

			{#if !fam}
				<div class="cer-reminder">
					<Receipt size={15} />{m.settings_ceremony_member_count({ count: seatsUsed + 1 })}
				</div>
			{/if}
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose} disabled={submitting}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!ready || submitting} onclick={submit}>
				{submitting
					? m.settings_ceremony_member_creating()
					: m.settings_ceremony_member_submit()}<ArrowRight size={15} />
			</Button>
		{:else}
			<Button variant="primary" onclick={() => {
					onComplete('member');
					onClose();
				}}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet mono(t: string)}<b class="mono">{t}</b>{/snippet}
