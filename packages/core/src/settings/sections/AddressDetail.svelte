<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Users from '@lucide/svelte/icons/users';
	import Star from '@lucide/svelte/icons/star';
	import Info from '@lucide/svelte/icons/info';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import Row from '../Row.svelte';
	import TextInput from '../TextInput.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import DelegationsCard from '../delegations/DelegationsCard.svelte';
	import ForwardingCard from '../forwarding/ForwardingCard.svelte';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';

	import { addresses } from '$core/stores/addresses.svelte';
	import { aliases } from '$core/stores/aliases.svelte';
	import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { delegations } from '$core/stores/delegations.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import { personAvatars } from '$core/stores/personAvatars.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { canManageWorkspace } from '../permissions';
	import { settingsPageTitle } from '../pageTitle.svelte';
	import { resumeStep } from '../domains/steps';
	import Rich from '$core/i18n/Rich.svelte';
	import {
		buildRow,
		dedupeAddresses,
		initialsOf,
		ledeFor,
		type ModelContext
	} from '../addressModel';

	interface Props {
		addressId: string;
	}

	let { addressId }: Props = $props();

	let nameDraft = $state('');
	let nameSeeded = $state('');
	let saving = $state(false);
	let nameError = $state<string | null>(null);
	let managingPeople = $state(false);
	let removing = $state(false);
	let removalBusy = $state(false);
	let removalError = $state<string | null>(null);

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/addresses`);
	const manage = $derived(canManageWorkspace());

	const ctx = $derived<ModelContext>({
		accountId: auth.accountId,
		manage,
		members: workspaces.members,
		domains: customDomains.items,
		sharedAliases: manage ? aliases.items : [],
		fullName: auth.fullName,
		delegationsFor: (id) => delegations.for(id),
		forwardingFor: (id) => readDelegations.for(id)
	});

	const source = $derived(
		manage
			? dedupeAddresses([addresses.items, workspaceAddresses.items])
			: dedupeAddresses([addresses.items])
	);
	const address = $derived(source.find((a) => a.id === addressId) ?? null);
	const row = $derived(address ? buildRow(ctx, address) : null);
	const alias = $derived(
		row?.sharedAliasId ? (aliases.items.find((a) => a.id === row.sharedAliasId) ?? null) : null
	);
	const ownDomain = $derived(Boolean(row?.customDomainId));
	const domainRow = $derived(
		row?.customDomainId
			? (customDomains.items.find((d) => d.id === row.customDomainId) ?? null)
			: null
	);
	const loaded = $derived(addresses.items.length > 0 || workspaceAddresses.items.length > 0);

	const currentName = $derived(alias?.name ?? address?.name ?? '');
	const dirty = $derived(nameDraft.trim() !== currentName.trim());

	$effect(() => {
		const next = currentName;
		if (nameSeeded === addressId) return;
		nameSeeded = addressId;
		nameDraft = next;
	});

	$effect(() => {
		if (!row) return;
		settingsPageTitle.setTrail({ label: m.settings_address_breadcrumb(), href: base }, row.email, true);
		return () => settingsPageTitle.set(null);
	});

	function avatarSrc(email: string): string | null {
		return email ? personAvatars.avatarUrl(email) : null;
	}

	async function saveName() {
		if (!row || !dirty || saving) return;
		saving = true;
		nameError = null;
		const name = nameDraft.trim();
		try {
			const workspaceId = workspaces.workspace?.id;
			if (row.kind === 'shared' && row.sharedAliasId && workspaceId) {
				await aliases.rename(workspaceId, row.sharedAliasId, name);
			} else {
				await addresses.update(row.id, { name: name === '' ? null : name });
			}
			await workspaceAddresses.reload();
		} catch (err) {
			nameError = err instanceof Error ? err.message : m.settings_address_save_name_failed();
		} finally {
			saving = false;
		}
	}

	async function promote() {
		if (!row) return;
		try {
			await addresses.setPrimary(row.id);
			await addresses.load();
			await workspaceAddresses.reload();
		} catch (err) {
			nameError = err instanceof Error ? err.message : m.settings_address_promote_failed();
		}
	}

	async function confirmRemoval() {
		if (!row || removalBusy) return;
		removalBusy = true;
		removalError = null;
		try {
			const workspaceId = workspaces.workspace?.id;
			if (row.kind === 'shared' && row.sharedAliasId && workspaceId) {
				await aliases.remove(workspaceId, row.sharedAliasId);
				await addresses.load();
			} else {
				await addresses.remove(row.id);
			}
			await workspaceAddresses.reload();
			removing = false;
			await goto(base);
		} catch (err) {
			removalError =
				err instanceof Error && err.message ? err.message : m.settings_address_remove_failed();
		} finally {
			removalBusy = false;
		}
	}
</script>

{#if !row}
	<p class="addr-note">
		{#if loaded}{m.settings_address_unavailable()}{:else}{m.common_loading()}{/if}
	</p>
{:else}
	<div class="ad-hero">
		<span class="ad-hero-chip">
			{#if row.kind === 'shared'}<Users size={20} />{:else}<AtSign size={20} />{/if}
		</span>
		<div class="ad-hero-tx">
			<div class="ad-hero-title">
				<span class="ad-name">{row.title}</span>
				{#if row.isPrimary}<Badge kind="pine">{m.settings_address_primary()}</Badge>{/if}
				{#if row.kind === 'shared'}<Badge kind="neutral">{m.settings_address_shared()}</Badge>{/if}
				{#if row.rotationRequired}<Badge kind="warn" dot>{m.settings_address_needs_new_key()}</Badge>{/if}
				{#if row.health === 'suspended'}
					<Badge kind="warn" dot>{m.settings_address_suspended()}</Badge>
				{:else if row.health === 'paused'}
					<Badge kind="warn" dot>{m.settings_domains_status_paused()}</Badge>
				{/if}
			</div>
			<div class="ad-lede">{ledeFor(ctx, row)}</div>
		</div>
	</div>

	{#if row.health === 'suspended'}
		<div class="ad-alert">
			<span class="ad-alert-ic"><CircleAlert size={15} /></span>
			<div class="ad-alert-tx">
				<b>{m.settings_address_suspended_title()}</b>
				{m.settings_address_suspended_body({ domain: row.domain })}
			</div>
			{#if manage && domainRow}
				<Button
					variant="secondary"
					size="sm"
					href={`/u/${slot}/settings/domains/${domainRow.id}?step=${resumeStep(domainRow)}`}
				>
					{m.settings_address_suspended_action()}
				</Button>
			{/if}
		</div>
	{/if}

	{#if row.rotationRequired}
		<div class="ad-alert">
			<span class="ad-alert-ic"><KeyRound size={15} /></span>
			<div class="ad-alert-tx">
				<b>{m.settings_address_rotate_title()}</b>
				{m.settings_address_rotate_body()}
			</div>
			{#if row.canManagePeople}
				<Button variant="secondary" size="sm" onclick={() => (managingPeople = true)}>
					{m.settings_address_manage_people()}
				</Button>
			{/if}
		</div>
	{/if}

	{#if row.canRename || row.isOwnPersonal}
	<div class="scard">
		<CardHead icon={AtSign} title={m.settings_address_identity()} />
		{#if row.canRename}
			<Row
				t={m.settings_address_display_name()}
				d={row.kind === 'shared'
					? m.settings_address_display_name_shared_desc()
					: m.settings_address_display_name_desc()}
			>
				<span class="ad-name-ctl">
					<TextInput
						value={nameDraft}
						onChange={(v) => (nameDraft = v)}
						placeholder={auth.fullName ?? m.settings_address_display_name()}
						w="mid"
					/>
					<Button
						variant={dirty ? 'primary' : 'secondary'}
						size="sm"
						disabled={!dirty || saving}
						onclick={() => void saveName()}
					>
						{saving ? m.settings_address_saving() : m.common_save()}
					</Button>
				</span>
			</Row>
		{/if}
		{#if row.isOwnPersonal}
			<Row
				t={m.settings_address_primary_title()}
				d={m.settings_address_primary_desc()}
			>
				{#if row.isPrimary}
					<Badge kind="pine">{m.settings_address_primary()}</Badge>
				{:else}
					<Button
						variant="secondary"
						size="sm"
						disabled={!row.canPromote}
						onclick={() => void promote()}
					>
						<Star size={14} />{m.settings_address_make_primary()}
					</Button>
				{/if}
			</Row>
		{/if}
		{#if nameError}<div class="card-empty err">{nameError}</div>{/if}
	</div>
	{:else}
		<div class="ad-note">
			<Info size={14} />
			<span>
				{m.settings_address_belongs_to({ name: row.people[0]?.name ?? m.settings_address_another_member_lower() })}
			</span>
		</div>
	{/if}

	{#if row.kind === 'shared'}
		<div class="scard">
			<CardHead icon={Users} title={m.settings_address_people()}>
				{#snippet right()}
					<span class="card-meta">
						{m.settings_address_used_people({ count: row.people.length })}
					</span>
					{#if row.canManagePeople}
						<Button variant="secondary" size="sm" onclick={() => (managingPeople = true)}>
							<Users size={13} />{m.settings_address_change_people()}
						</Button>
					{/if}
				{/snippet}
			</CardHead>
			{#each row.people as p (p.accountId)}
				<div class="ad-person">
					<Avatar
						initials={initialsOf(p.name, p.email)}
						size={28}
						src={avatarSrc(p.email)}
						fit="cover"
					/>
					<div class="ad-person-tx">
						<div class="ad-person-name">
							{p.name}
							{#if p.accountId === auth.accountId}<span class="ad-you">{m.settings_address_you_tag()}</span>{/if}
						</div>
						<div class="ad-person-mail mono">{p.email}</div>
					</div>
					<span class="ad-person-role">{m.settings_address_person_role()}</span>
				</div>
			{/each}
			<div class="ad-people-note">
				<Info size={13} />
				<span>
					{m.settings_address_people_note()}
				</span>
			</div>
		</div>
	{/if}

	{#if !ownDomain}
		<div class="ad-note">
			<Info size={14} />
			<span>
				{m.settings_address_own_domain_only({ domain: row.domain })}
			</span>
		</div>
	{/if}

	{#if row.canDelegate && address}
		<DelegationsCard {address} />
	{/if}

	{#if row.canForward && address}
		<ForwardingCard addressId={address.id} email={address.email} />
	{/if}

	{#if row.canRemove}
		<div class="scard danger">
			<CardHead icon={TriangleAlert} title={m.settings_address_remove_card()} />
			<Row
				t={row.kind === 'shared'
					? m.settings_address_remove_shared()
					: row.isMine
						? m.settings_address_remove_card()
						: m.settings_address_remove_member_alias({
								name: row.people[0]?.name ?? m.settings_address_this_member()
							})}
				d={m.settings_address_remove_desc()}
			>
				<Button variant="danger" size="sm" onclick={() => (removing = true)}>
					<Trash2 size={14} />{m.settings_address_remove()}
				</Button>
			</Row>
		</div>
	{/if}

	{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}

	{#snippet removalBody()}
		<p class="cfd-p">
			<Rich text={m.settings_address_remove_confirm_body({ email: row.email })} tags={{ mono }} />
		</p>
		{#if row.kind === 'shared' && row.people.length}
			<p class="cfd-p">
				{m.settings_address_remove_confirm_people({ count: row.people.length })}
			</p>
		{/if}
	{/snippet}

	{#if removing}
		<ConfirmDialog
			icon={Trash2}
			tone="danger"
			title={m.settings_address_remove_title()}
			sub={row.email}
			confirmLabel={m.settings_address_remove()}
			busy={removalBusy}
			error={removalError}
			body={removalBody}
			onConfirm={() => void confirmRemoval()}
			onClose={() => {
				if (!removalBusy) removing = false;
			}}
		/>
	{/if}

	{#if managingPeople && alias}
		<AliasCeremony
			mode="members"
			{alias}
			onClose={() => (managingPeople = false)}
			onComplete={() => {}}
		/>
	{/if}
{/if}
