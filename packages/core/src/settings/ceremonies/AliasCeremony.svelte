<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import User from '@lucide/svelte/icons/user';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import Select from '../Select.svelte';
	import type { CeremonyKind } from '../data';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { SHARED_DOMAIN } from '$core/settings/entitlements';
	import { checkAddressAvailability } from '$core/api/auth';
	import { ownershipProven } from '$core/settings/domains/steps';
	import { addresses } from '$core/stores/addresses.svelte';
	import { aliases } from '$core/stores/aliases.svelte';
	import { aliasKeys } from '$core/stores/aliasKeys.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import { hexToB64, textToB64 } from '$core/keys/encode';
	import { lookupDirectory } from '$core/directory/lookup';
	import { verifyDirectoryLookup, DirectoryVerificationError } from '$core/directory/verify';
	import { createWorkspaceAlias } from '$core/api/aliases';
	import type { SharedAlias, SharedAliasMemberGrant } from '$core/api/aliases';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { RadioGroup, RadioGroupItem } from '$core/components/ui/radio-group';
	import { Label } from '$core/components/ui/label';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		mode?: 'create' | 'members';
		alias?: SharedAlias | null;
		presetDomainId?: string | null;
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { mode = 'create', alias = null, presetDomainId = null, onClose, onComplete }: Props = $props();

	const steps = $derived(
		mode === 'create'
			? [
					m.settings_ceremony_alias_step_address(),
					m.settings_ceremony_alias_step_people(),
					m.settings_ceremony_alias_step_done()
				]
			: [m.settings_ceremony_alias_step_people(), m.settings_ceremony_alias_step_done()]
	);
	let step = $state(0);
	let local = $state('');
	let name = $state('');
	let sharedPicked = $state(mode === 'members');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let progress = $state<string | null>(null);
	let createdEmail = $state<string | null>(null);

	const ownedDomains = $derived(customDomains.items.filter(ownershipProven));
	const sharedSlotFree = $derived(
		billing.canAddSharedDomainAlias && !aliases.items.some((a) => !a.customDomainId)
	);
	const domainOptions = $derived([
		...ownedDomains.map((d) => d.domain),
		...(sharedSlotFree ? [SHARED_DOMAIN] : [])
	]);
	let userPickedDomainId = $state<string | null>(presetDomainId);

	const selectedDomainName = $derived(
		domainOptions.includes(userPickedDomainId ?? '')
			? (userPickedDomainId as string)
			: (ownedDomains.find((d) => d.id === userPickedDomainId)?.domain ?? domainOptions[0] ?? '')
	);
	const onSharedDomain = $derived(selectedDomainName === SHARED_DOMAIN);
	const shared = $derived(sharedPicked || onSharedDomain);
	const selectedDomain = $derived(ownedDomains.find((d) => d.domain === selectedDomainName) ?? null);

	const localOk = $derived(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(local.trim()));
	const nameOk = $derived(name.trim().length > 0);
	const full = $derived(
		createdEmail ??
			alias?.email ??
			(local.trim() || 'name') + '@' + (selectedDomainName || 'example.com')
	);

	const members = $derived(workspaces.members);
	let picked = $state<string[]>([]);
	let initialised = $state(false);

	$effect(() => {
		if (initialised) return;
		if (mode === 'members' && alias) {
			picked = alias.members.map((m) => m.accountId);
			initialised = true;
		} else if (members.length && auth.accountId) {
			picked = [auth.accountId];
			initialised = true;
		}
	});

	const before = $derived(alias ? alias.members.map((m) => m.accountId) : []);
	const adding = $derived(picked.filter((id) => !before.includes(id)));
	const removing = $derived(before.filter((id) => !picked.includes(id)));
	const changed = $derived(mode === 'create' || adding.length > 0 || removing.length > 0);

	function initialsOf(fullName: string, email: string): string {
		const src = (fullName || email).trim();
		const parts = src.split(/[\s@.]+/).filter(Boolean);
		return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src.slice(0, 2).toUpperCase();
	}

	function nameOf(accountId: string): string {
		const member = members.find((x) => x.accountId === accountId);
		return member?.fullName || member?.email || m.settings_ceremony_alias_member_fallback();
	}

	function toggle(accountId: string) {
		picked = picked.includes(accountId)
			? picked.filter((id) => id !== accountId)
			: [...picked, accountId];
	}

	function pickDomain(n: string) {
		userPickedDomainId = n;
	}

	async function resolveRecipients(emails: { accountId: string; email: string }[]) {
		const out = [];
		for (const target of emails) {
			progress = m.settings_ceremony_alias_progress_verifying({ email: target.email });
			const lookup = await lookupDirectory(target.email);
			await verifyDirectoryLookup(lookup, target.email.trim().toLowerCase());
			out.push({ accountId: target.accountId, publicKeyArmored: lookup.publicKeyArmored });
		}
		return out;
	}

	async function submitShared() {
		const ws = workspaces.workspace?.id;
		const accountId = auth.accountId;
		if (!ws || !accountId) throw new Error('no workspace');
		const targets = picked
			.map((id) => members.find((m) => m.accountId === id))
			.filter((m): m is NonNullable<typeof m> => !!m)
			.map((m) => ({ accountId: m.accountId, email: m.email }));
		if (!targets.length) throw new Error(m.settings_ceremony_alias_err_pick_one());

		const recipients = await resolveRecipients(targets);

		if (mode === 'create' && onSharedDomain) {
			progress = m.settings_ceremony_alias_progress_checking();
			const { available } = await checkAddressAvailability(local.trim().toLowerCase());
			if (!available) throw new Error(m.settings_ceremony_alias_err_taken());
		}

		progress = m.settings_ceremony_alias_progress_creating_key();
		const email = alias?.email ?? `${local.trim().toLowerCase()}@${selectedDomainName}`;
		const created = await keystore.createAliasKey({
			accountId,
			email,
			displayName: alias?.name ?? name.trim(),
			recipients
		});
		if (!created.ok) {
			throw new Error(
				created.code === 'locked'
					? m.settings_ceremony_alias_err_unlock()
					: m.settings_ceremony_alias_err_create_key()
			);
		}
		const grants: SharedAliasMemberGrant[] = created.grants.map((g) => ({
			accountId: g.accountId,
			memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
			wrappedPrivateKey: textToB64(g.wrappedPrivateKeyArmored)
		}));

		progress = m.settings_ceremony_alias_progress_saving();
		if (mode === 'members' && alias) {
			await aliases.rotate(ws, alias.id, {
				aliasPublicKeyArmored: created.publicKeyArmored,
				members: grants
			});
		} else {
			createdEmail = email;
			await aliases.create(ws, {
				customDomainId: onSharedDomain ? undefined : selectedDomain!.id,
				localPart: local.trim().toLowerCase(),
				name: name.trim(),
				aliasPublicKeyArmored: created.publicKeyArmored,
				members: grants
			});
		}
		await Promise.all([addresses.load(), aliasKeys.load(accountId)]);
	}

	async function submitPersonal() {
		const ws = workspaces.workspace?.id;
		if (!ws || !selectedDomain) throw new Error('no workspace');
		const assignee = picked[0];
		if (!assignee) throw new Error(m.settings_ceremony_alias_err_pick_owner());
		await createWorkspaceAlias(ws, {
			customDomainId: selectedDomain.id,
			localPart: local.trim().toLowerCase(),
			assigneeAccountId: assignee,
			name: name.trim() || undefined
		});
		await addresses.load();
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		submitError = null;
		try {
			if (shared) await submitShared();
			else await submitPersonal();
			step = steps.length - 1;
		} catch (err) {
			if (err instanceof DirectoryVerificationError) {
				submitError = m.settings_ceremony_alias_err_verify_key({ code: err.code });
			} else {
				submitError = err instanceof Error ? err.message : m.settings_ceremony_alias_err_save();
			}
		} finally {
			submitting = false;
			progress = null;
		}
	}

	const peopleStep = $derived(mode === 'create' ? 1 : 0);
	const canSubmit = $derived(
		(mode === 'members' || (localOk && nameOk && !!selectedDomainName)) &&
			picked.length > 0 &&
			changed
	);
</script>

<CeremonyShell
	icon={Users}
	eyebrow={m.settings_ceremony_alias_eyebrow()}
	title={mode === 'members'
		? m.settings_ceremony_alias_title_members()
		: m.settings_ceremony_alias_title_create()}
	{steps}
	{step}
	{onClose}
>
	{#if mode === 'create' && step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					{#if sharedSlotFree && ownedDomains.length === 0}
						{m.settings_ceremony_alias_lede_shared_domain({ domain: SHARED_DOMAIN })}
					{:else}
						{m.settings_ceremony_alias_lede_own_domain()}
					{/if}
				</p>
			</div>
			{#if customDomains.loading && customDomains.items.length === 0 && !sharedSlotFree}
				<div class="field-hint">{m.settings_ceremony_alias_loading_domains()}</div>
			{:else if domainOptions.length === 0}
				<div class="inline-warn">
					<CircleAlert size={15} />
					<span
						><Rich text={m.settings_ceremony_alias_need_domain()} tags={{ b: bold }} /></span
					>
				</div>
			{:else}
				<div class="field">
					<label for="alias-name">{m.settings_ceremony_alias_display_name()}</label>
					<input
						id="alias-name"
						class="tin"
						bind:value={name}
						maxlength="120"
						placeholder={m.settings_ceremony_alias_display_name_placeholder()}
						autocomplete="off"
					/>
					<div class="field-hint">{m.settings_ceremony_alias_display_name_hint()}</div>
				</div>
				<div class="field">
					<label for="alias-local">{m.settings_ceremony_alias_address_label()}</label>
					<div class="alias-compose">
						<input
							id="alias-local"
							class="tin mono"
							bind:value={local}
							placeholder="support"
							autocomplete="off"
						/>
						<span class="ac-at">@</span>
						<Select value={selectedDomainName} options={domainOptions} onChange={pickDomain} />
					</div>
					{#if local.length > 0 && !localOk}
						<div class="field-hint bad">
							<CircleAlert size={13} />{m.settings_ceremony_alias_local_invalid()}
						</div>
					{/if}
				</div>
				{#if onSharedDomain}
					<div class="field-hint">
						{m.settings_ceremony_alias_shared_domain_hint({ domain: SHARED_DOMAIN })}
					</div>
				{:else}
					<div class="field">
						<span class="field-lbl">{m.settings_ceremony_alias_who_uses()}</span>
						<RadioGroup
							class="choice-set two"
							value={shared ? 'shared' : 'single'}
							onValueChange={(v) => (sharedPicked = v === 'shared')}
						>
							<Label class="choice" for="alias-kind-single" data-on={!shared}>
								<RadioGroupItem id="alias-kind-single" value="single" class="choice-mark" />
								<span class="choice-ic"><User size={16} /></span>
								<span class="choice-tx">
									<span class="choice-t">{m.settings_ceremony_alias_kind_single()}</span>
									<span class="choice-d">
										{m.settings_ceremony_alias_kind_single_desc()}
									</span>
								</span>
							</Label>
							<Label class="choice" for="alias-kind-shared" data-on={shared}>
								<RadioGroupItem id="alias-kind-shared" value="shared" class="choice-mark" />
								<span class="choice-ic"><Users size={16} /></span>
								<span class="choice-tx">
									<span class="choice-t">{m.settings_ceremony_alias_kind_shared()}</span>
									<span class="choice-d">
										{m.settings_ceremony_alias_kind_shared_desc()}
									</span>
								</span>
							</Label>
						</RadioGroup>
					</div>
				{/if}
				<div class="identity-preview">
					<span class="ip-label">{m.settings_ceremony_alias_preview()}</span>
					<span class="ip-from">
						{#if name.trim()}<b>{name.trim()}</b>{/if}
						<span class="mono">&lt;{full}&gt;</span>
					</span>
				</div>
			{/if}
		</div>
	{:else if step === peopleStep}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					{#if shared}
						<Rich text={m.settings_ceremony_alias_people_shared({ email: full })} tags={{ addr: mono }} />
					{:else}
						<Rich text={m.settings_ceremony_alias_people_single({ email: full })} tags={{ addr: mono }} />
					{/if}
				</p>
			</div>
			{#if shared}
				<div class="choice-set">
					{#each members as m (m.accountId)}
						<Label class="choice" for={`am-${m.accountId}`} data-on={picked.includes(m.accountId)}>
							<Checkbox
								id={`am-${m.accountId}`}
								class="choice-mark"
								checked={picked.includes(m.accountId)}
								onCheckedChange={() => toggle(m.accountId)}
							/>
							<Avatar initials={initialsOf(m.fullName, m.email)} size={28} />
							<span class="choice-tx">
								<span class="choice-t">{m.fullName || m.email}</span>
								<span class="choice-d">{m.email}</span>
							</span>
						</Label>
					{/each}
				</div>
			{:else}
				<RadioGroup
					class="choice-set"
					value={picked[0] ?? ''}
					onValueChange={(v) => (picked = v ? [v] : [])}
				>
					{#each members as m (m.accountId)}
						<Label class="choice" for={`am-${m.accountId}`} data-on={picked.includes(m.accountId)}>
							<RadioGroupItem id={`am-${m.accountId}`} value={m.accountId} class="choice-mark" />
							<Avatar initials={initialsOf(m.fullName, m.email)} size={28} />
							<span class="choice-tx">
								<span class="choice-t">{m.fullName || m.email}</span>
								<span class="choice-d">{m.email}</span>
							</span>
						</Label>
					{/each}
				</RadioGroup>
			{/if}

			{#if shared && changed && mode === 'members'}
				<div class="inline-warn">
					<CircleAlert size={15} />
					<span>
						{m.settings_ceremony_alias_rekey_warning()}
						{#if adding.length}
							{m.settings_ceremony_alias_rekey_adding({ names: adding.map(nameOf).join(', ') })}
						{/if}
						{#if removing.length}
							{m.settings_ceremony_alias_rekey_removing({ names: removing.map(nameOf).join(', ') })}
						{/if}
					</span>
				</div>
			{/if}

			{#if submitError}
				<div class="field-hint bad"><CircleAlert size={13} />{submitError}</div>
			{/if}
			{#if progress}
				<div class="field-hint">{progress}…</div>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={Users}
			title={mode === 'members'
				? m.settings_ceremony_alias_done_title_members()
				: m.settings_ceremony_alias_done_title_create()}
			desc={shared
				? m.settings_ceremony_alias_done_desc_shared()
				: m.settings_ceremony_alias_done_desc_single()}
		>
			<div class="done-pill"><span class="mono">{full}</span></div>
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if mode === 'create' && step === 0}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!localOk || !nameOk || !selectedDomainName} onclick={() => (step = 1)}>{m.common_continue()}</Button>
		{:else if step === peopleStep}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!canSubmit || submitting} onclick={submit}>
				{#if mode === 'members'}<Check size={15} />{:else}<Plus size={15} />{/if}
				{submitting
					? m.settings_ceremony_alias_saving()
					: mode === 'members'
						? m.settings_ceremony_alias_save_people()
						: m.settings_ceremony_alias_add_address()}
			</Button>
		{:else}
			<Button variant="primary" onclick={() => {
					onComplete('alias');
					onClose();
				}}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
{#snippet bold(t: string)}<b>{t}</b>{/snippet}
