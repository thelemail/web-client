<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Users from '@lucide/svelte/icons/users';
	import Globe from '@lucide/svelte/icons/globe';
	import Plus from '@lucide/svelte/icons/plus';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Star from '@lucide/svelte/icons/star';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Forward from '@lucide/svelte/icons/forward';
	import Clock from '@lucide/svelte/icons/clock';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import Badge from '../Badge.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import CatchAllCard from './CatchAllCard.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';

	import type { CeremonyKind, SettingsState } from '../data';
	import { addresses } from '$core/stores/addresses.svelte';
	import { aliases } from '$core/stores/aliases.svelte';
	import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { delegations } from '$core/stores/delegations.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import { personAvatars } from '$core/stores/personAvatars.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { canManageWorkspace } from '../permissions';
	import { SHARED_DOMAIN } from '../entitlements';
	import {
		buildRow,
		groupByDomain,
		dedupeAddresses,
		initialsOf,
		planNote,
		type AddressRow,
		type ModelContext
	} from '../addressModel';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	let menuFor = $state<string | null>(null);
	let managingId = $state<string | null>(null);
	let pendingRemoval = $state<{ email: string; run: () => Promise<void> } | null>(null);
	let removalBusy = $state(false);
	let removalError = $state<string | null>(null);

	const slot = $derived(page.params.slot ?? '0');
	const manage = $derived(canManageWorkspace());
	const showCatchAll = $derived(workspaces.isOwner(auth.accountId));

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
	const rows = $derived(source.map((a) => buildRow(ctx, a)));
	const groups = $derived(groupByDomain(ctx, rows));
	const managing = $derived(
		managingId ? (aliases.items.find((a) => a.id === managingId) ?? null) : null
	);

	const sharedSlotUsed = $derived(rows.some((r) => r.kind === 'shared' && r.domain === SHARED_DOMAIN));
	const canAddMore = $derived(billing.canAddDomains || !sharedSlotUsed);
	const canAdd = $derived(manage && billing.canAddSharedAddresses && canAddMore);

	const delegableIds = $derived(
		source
			.filter((a) => a.customDomainId && !a.shared && a.accountId === auth.accountId)
			.map((a) => a.id)
	);
	const forwardableIds = $derived(
		source
			.filter(
				(a) =>
					a.customDomainId && (a.accountId === auth.accountId || (Boolean(a.shared) && manage))
			)
			.map((a) => a.id)
	);

	$effect(() => {
		for (const id of delegableIds) void delegations.load(id);
	});

	$effect(() => {
		for (const id of forwardableIds) void readDelegations.load(id);
	});

	function href(row: AddressRow): string {
		return `/u/${slot}/settings/addresses/${row.id}`;
	}

	function open(row: AddressRow) {
		menuFor = null;
		void goto(href(row));
	}

	function dismiss(e: Event) {
		if (menuFor === null) return;
		const t = e.target;
		if (t instanceof Element && t.closest('.addr-menu-wrap')) return;
		menuFor = null;
	}

	async function promote(row: AddressRow) {
		menuFor = null;
		try {
			await addresses.setPrimary(row.id);
			await addresses.load();
			await workspaceAddresses.reload();
		} catch (err) {
			console.warn('set primary failed', err);
		}
	}

	function managePeople(row: AddressRow) {
		menuFor = null;
		if (row.sharedAliasId) managingId = row.sharedAliasId;
	}

	function askRemoval(row: AddressRow) {
		menuFor = null;
		removalError = null;
		const workspaceId = workspaces.workspace?.id;
		if (row.kind === 'shared' && row.sharedAliasId && workspaceId) {
			const aliasId = row.sharedAliasId;
			pendingRemoval = {
				email: row.email,
				run: async () => {
					await aliases.remove(workspaceId, aliasId);
					await addresses.load();
					await workspaceAddresses.reload();
				}
			};
			return;
		}
		pendingRemoval = {
			email: row.email,
			run: async () => {
				await addresses.remove(row.id);
				await workspaceAddresses.reload();
			}
		};
	}

	async function confirmRemoval() {
		const pending = pendingRemoval;
		if (!pending || removalBusy) return;
		removalBusy = true;
		removalError = null;
		try {
			await pending.run();
			pendingRemoval = null;
		} catch (err) {
			removalError =
				err instanceof Error && err.message ? err.message : 'Could not remove this address.';
		} finally {
			removalBusy = false;
		}
	}

	function avatarSrc(email: string): string | null {
		return email ? personAvatars.avatarUrl(email) : null;
	}
</script>

<svelte:window onclick={dismiss} />

<div class="addr-intro">
	<div class="addr-intro-tx">
		<p class="addr-lede">
			The addresses you send and receive as, and the aliases set up for the workspace. Open one to
			change its name, its people, who may sign as it, and where its mail is forwarded.
		</p>
		{#if manage}
			<p class="addr-plan">{planNote(sharedSlotUsed)}</p>
		{/if}
	</div>
	{#if canAdd}
		<div class="addr-intro-act">
			<Button variant="primary" onclick={() => launch('alias')}>
				<Plus size={14} />Add an alias
			</Button>
		</div>
	{/if}
</div>

{#each groups as g (g.domain)}
	<section class="scard addr-group">
		<div class="scard-h addr-group-h">
			<Globe size={16} />
			<h3 class="addr-domain">{g.domain}</h3>
			<Badge kind={g.badgeTone}>{g.badge}</Badge>
			<span class="addr-count">{g.count}</span>
		</div>
		<div class="addr-cols">
			<span>Address</span><span>Used by</span><span></span>
		</div>
		{#each g.rows as row (row.id)}
			<div class="addr-row">
				<a class="addr-main" href={href(row)}>
					<span class="addr-chip">
						{#if row.kind === 'shared'}<Users size={15} />{:else}<AtSign size={15} />{/if}
					</span>
					<span class="addr-text">
						<span class="addr-title">
							<span class="addr-name">{row.title}</span>
							{#if row.isPrimary}<Badge kind="pine">Primary</Badge>{/if}
							{#if row.rotationRequired}<Badge kind="warn" dot>Needs a new key</Badge>{/if}
						</span>
						<span class="addr-mail">{row.email}</span>
						{#if row.signerSummary || row.forwardSummary || row.pendingSummary}
							<span class="addr-sum">
								{#if row.signerSummary}
									<span><KeyRound size={12} />{row.signerSummary}</span>
								{/if}
								{#if row.forwardSummary}
									<span><Forward size={12} />{row.forwardSummary}</span>
								{/if}
								{#if row.pendingSummary}
									<span class="pending"><Clock size={12} />{row.pendingSummary}</span>
								{/if}
							</span>
						{/if}
					</span>
				</a>
				<div class="addr-used">
					<span class="avstack">
						{#each row.people.slice(0, 3) as p (p.accountId)}
							<Avatar
								initials={initialsOf(p.name, p.email)}
								size={24}
								src={avatarSrc(p.email)}
								fit="cover"
							/>
						{/each}
					</span>
					<span class="addr-used-tx">{row.usedBy}</span>
				</div>
				<div class="addr-menu-wrap">
					<button
						type="button"
						class="rowmenu"
						aria-label="Address actions"
						aria-expanded={menuFor === row.id}
						onclick={() => (menuFor = menuFor === row.id ? null : row.id)}
					>
						<Ellipsis size={16} />
					</button>
					{#if menuFor === row.id}
						<div class="addr-menu" role="menu">
							<button type="button" class="mitem" onclick={() => open(row)}>
								<ArrowRight size={15} />Open
							</button>
							{#if row.canPromote}
								<button type="button" class="mitem" onclick={() => promote(row)}>
									<Star size={15} />Make primary
								</button>
							{/if}
							{#if row.canRename}
								<button type="button" class="mitem" onclick={() => open(row)}>
									<PenLine size={15} />Rename
								</button>
							{/if}
							{#if row.canManagePeople}
								<button type="button" class="mitem" onclick={() => managePeople(row)}>
									<Users size={15} />Manage people
								</button>
							{/if}
							{#if row.canRemove}
								<span class="msep"></span>
								<button type="button" class="mitem danger" onclick={() => askRemoval(row)}>
									<Trash2 size={15} />Remove address
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</section>
{/each}

{#if addresses.loading && rows.length === 0}
	<p class="addr-note">Loading…</p>
{:else if rows.length === 0}
	<p class="addr-note">No addresses yet.</p>
{/if}

{#if !manage}
	<p class="addr-note">New addresses are set up by a workspace admin.</p>
{/if}

{#if manage && !billing.canAddSharedAddresses}
	<div class="upgrade-list">
		<UpgradeNudge
			title="More addresses come with a paid plan"
			desc="Paid plans add unlimited addresses on your own domain, shared with the people you choose."
		/>
	</div>
{:else if manage && !canAddMore}
	<div class="upgrade-list">
		<UpgradeNudge
			title="One shared address on {SHARED_DOMAIN}"
			desc="Add a domain you own on a paid plan to give the household more addresses."
		/>
	</div>
{/if}

{#if addresses.error}
	<p class="addr-note err">{addresses.error}</p>
{/if}
{#if workspaceAddresses.error}
	<p class="addr-note err">{workspaceAddresses.error}</p>
{/if}

{#if showCatchAll}
	<div class="addr-catchall"><CatchAllCard /></div>
{/if}

{#snippet removalBody()}
	<p class="cfd-p">Mail sent to this address will stop being accepted.</p>
{/snippet}

{#if pendingRemoval}
	<ConfirmDialog
		icon={Trash2}
		tone="danger"
		title="Remove this address?"
		sub={pendingRemoval.email}
		confirmLabel="Remove address"
		busy={removalBusy}
		error={removalError}
		body={removalBody}
		onConfirm={() => void confirmRemoval()}
		onClose={() => {
			if (!removalBusy) pendingRemoval = null;
		}}
	/>
{/if}

{#if managing}
	<AliasCeremony
		mode="members"
		alias={managing}
		onClose={() => (managingId = null)}
		onComplete={() => {}}
	/>
{/if}
