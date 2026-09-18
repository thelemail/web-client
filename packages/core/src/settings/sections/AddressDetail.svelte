<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Users from '@lucide/svelte/icons/users';
	import Star from '@lucide/svelte/icons/star';
	import Info from '@lucide/svelte/icons/info';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
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
		settingsPageTitle.setTrail({ label: 'Addresses', href: base }, row.email, true);
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
			nameError = err instanceof Error ? err.message : 'Could not save this name.';
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
			nameError = err instanceof Error ? err.message : 'Could not make this the primary address.';
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
				err instanceof Error && err.message ? err.message : 'Could not remove this address.';
		} finally {
			removalBusy = false;
		}
	}
</script>

{#if !row}
	<p class="addr-note">
		{#if loaded}This address is no longer available.{:else}Loading…{/if}
	</p>
{:else}
	<div class="ad-hero">
		<span class="ad-hero-chip">
			{#if row.kind === 'shared'}<Users size={20} />{:else}<AtSign size={20} />{/if}
		</span>
		<div class="ad-hero-tx">
			<div class="ad-hero-title">
				<span class="ad-name">{row.title}</span>
				{#if row.isPrimary}<Badge kind="pine">Primary</Badge>{/if}
				{#if row.kind === 'shared'}<Badge kind="neutral">Shared</Badge>{/if}
				{#if row.rotationRequired}<Badge kind="warn" dot>Needs a new key</Badge>{/if}
			</div>
			<div class="ad-lede">{ledeFor(ctx, row)}</div>
		</div>
	</div>

	{#if row.rotationRequired}
		<div class="ad-alert">
			<span class="ad-alert-ic"><KeyRound size={15} /></span>
			<div class="ad-alert-tx">
				<b>This address needs a new key.</b>
				Someone on it left the workspace. Save its people again and a fresh key is issued to everyone
				who stays.
			</div>
			{#if row.canManagePeople}
				<Button variant="secondary" size="sm" onclick={() => (managingPeople = true)}>
					Manage people
				</Button>
			{/if}
		</div>
	{/if}

	{#if row.canRename || row.isOwnPersonal}
	<div class="scard">
		<CardHead icon={AtSign} title="Identity" />
		{#if row.canRename}
			<Row
				t="Display name"
				d={row.kind === 'shared'
					? 'The name people see when anyone writes from this address.'
					: 'The name people see when you write from this address. Leave it empty to use your profile name.'}
			>
				<span class="ad-name-ctl">
					<TextInput
						value={nameDraft}
						onChange={(v) => (nameDraft = v)}
						placeholder={auth.fullName ?? 'Display name'}
						w="mid"
					/>
					<Button
						variant={dirty ? 'primary' : 'secondary'}
						size="sm"
						disabled={!dirty || saving}
						onclick={() => void saveName()}
					>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</span>
			</Row>
		{/if}
		{#if row.isOwnPersonal}
			<Row
				t="Primary address"
				d="Your default From and the email you sign in with. One address at a time."
			>
				{#if row.isPrimary}
					<Badge kind="pine">Primary</Badge>
				{:else}
					<Button variant="secondary" size="sm" onclick={() => void promote()}>
						<Star size={14} />Make primary
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
				This address belongs to {row.people[0]?.name ?? 'another member'}. Its name, signing and
				forwarding are managed from their own settings.
			</span>
		</div>
	{/if}

	{#if row.kind === 'shared'}
		<div class="scard">
			<CardHead icon={Users} title="People">
				{#snippet right()}
					<span class="card-meta">
						{row.people.length}
						{row.people.length === 1 ? 'person' : 'people'}
					</span>
					{#if row.canManagePeople}
						<Button variant="secondary" size="sm" onclick={() => (managingPeople = true)}>
							<Users size={13} />Change people
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
							{#if p.accountId === auth.accountId}<span class="ad-you">you</span>{/if}
						</div>
						<div class="ad-person-mail mono">{p.email}</div>
					</div>
					<span class="ad-person-role">Receives a copy · can write from it</span>
				</div>
			{/each}
			<div class="ad-people-note">
				<Info size={13} />
				<span>
					Changing who is on this address gives it a new key. Newcomers see mail that arrives from
					then on, not what came before. Anyone removed keeps what was already delivered.
				</span>
			</div>
		</div>
	{/if}

	{#if !ownDomain}
		<div class="ad-note">
			<Info size={14} />
			<span>
				Signing delegation and forwarding are available for addresses on a domain you own.
				Addresses on {row.domain} do not have them.
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
			<CardHead icon={TriangleAlert} title="Remove this address" />
			<Row
				t={row.kind === 'shared'
					? 'Remove this shared alias'
					: row.isMine
						? 'Remove this address'
						: `Remove ${row.people[0]?.name ?? 'this member'}'s alias`}
				d="Mail sent to it will stop being accepted. Anything already delivered stays where it is."
			>
				<Button variant="danger" size="sm" onclick={() => (removing = true)}>
					<Trash2 size={14} />Remove address
				</Button>
			</Row>
		</div>
	{/if}

	{#snippet removalBody()}
		<p class="cfd-p">
			Mail sent to <span class="mono">{row.email}</span> will stop being accepted.
		</p>
		{#if row.kind === 'shared' && row.people.length}
			<p class="cfd-p">
				{row.people.length}
				{row.people.length === 1 ? 'person loses' : 'people lose'} it from their From list. Mail already
				delivered to them stays in their mailboxes.
			</p>
		{/if}
	{/snippet}

	{#if removing}
		<ConfirmDialog
			icon={Trash2}
			tone="danger"
			title="Remove this address?"
			sub={row.email}
			confirmLabel="Remove address"
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
