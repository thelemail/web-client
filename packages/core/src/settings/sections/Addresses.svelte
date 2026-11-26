<script lang="ts">
	import LoadState from '$core/components/LoadState.svelte';
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRight,
		faAt,
		faCircleExclamation,
		faClock,
		faEllipsis,
		faGlobe,
		faKey,
		faPenLine,
		faPlus,
		faShare,
		faStar,
		faTrashCan,
		faUsers
	} from '@fortawesome/pro-regular-svg-icons';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { Badge } from '$core/components/ui/badge';
	import Card from '../Card.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import CatchAllCard from './CatchAllCard.svelte';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import AliasCeremony from '../ceremonies/AliasCeremony.svelte';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';

	import type { CeremonyKind } from '../data';
	import { addresses } from '$core/stores/addresses.svelte';
	import { aliases } from '$core/stores/aliases.svelte';
	import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { delegations } from '$core/stores/delegations.svelte';
	import { readDelegations } from '$core/stores/readDelegations.svelte';
	import { personAvatars } from '$core/stores/personAvatars.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { canManageWorkspace } from '../permissions';
	import { platformDomains } from '$core/stores/platformDomains.svelte';
	import {
		buildRow,
		groupByDomain,
		initialsOf,
		planNote,
		type AddressRow
	} from '../addressModel';
	import { addressContext, addressSource } from '../addressContext';
	import { makePrimary } from '../primaryAddress';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	let managingId = $state<string | null>(null);
	let pendingRemoval = $state<{ email: string; run: () => Promise<void> } | null>(null);
	let removalBusy = $state(false);
	let removalError = $state<string | null>(null);
	let promoteFailedId = $state<string | null>(null);

	const slot = $derived(page.params.slot ?? '0');
	const manage = $derived(canManageWorkspace());
	const roleKnown = $derived(workspaces.membersLoaded || (workspaces.loaded && !workspaces.workspace));
	const showCatchAll = $derived(workspaces.isOwner(auth.accountId));

	const ctx = $derived(addressContext(manage));
	const source = $derived(addressSource(manage));
	const rows = $derived(source.map((a) => buildRow(ctx, a)));
	const groups = $derived(groupByDomain(ctx, rows));
	const managing = $derived(
		managingId ? (aliases.items.find((a) => a.id === managingId) ?? null) : null
	);

	const sharedSlotDomain = $derived(
		rows.find((r) => r.kind === 'shared' && platformDomains.includes(r.domain))?.domain
	);
	const sharedSlotUsed = $derived(sharedSlotDomain !== undefined);
	const slotDomain = $derived(sharedSlotDomain ?? platformDomains.display());
	const canAddMore = $derived(billing.canAddDomains || !sharedSlotUsed);
	const canAdd = $derived(manage && billing.canAddSharedAddresses && canAddMore);
	const note = $derived(
		manage ? planNote(billing.planCode, sharedSlotUsed, slotDomain) : null
	);

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
		void goto(href(row));
	}

	async function promote(row: AddressRow) {
		promoteFailedId = null;
		try {
			await makePrimary(row.id);
		} catch {
			promoteFailedId = row.id;
		}
	}

	function managePeople(row: AddressRow) {
		if (row.sharedAliasId) managingId = row.sharedAliasId;
	}

	function askRemoval(row: AddressRow) {
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
				err instanceof Error && err.message ? err.message : m.settings_address_remove_failed();
		} finally {
			removalBusy = false;
		}
	}

	function avatarSrc(email: string): string | null {
		return email ? personAvatars.avatarUrl(email) : null;
	}
</script>


<div class="addr-intro">
	<div class="addr-intro-tx">
		<p class="addr-lede">
			{m.settings_address_list_lede()}
		</p>
		{#if note}
			<p class="addr-plan">{note}</p>
		{/if}
	</div>
	{#if canAdd}
		<div class="addr-intro-act">
			<Button variant="primary" onclick={() => launch('alias')}>
				<Icon icon={faPlus} size={14} />{m.settings_address_add_alias()}
			</Button>
		</div>
	{/if}
</div>

{#each groups as g (g.domain)}
	<Card as="section" class="addr-group" headClass="addr-group-h" titleClass="addr-domain" icon={faGlobe} title={g.domain}>
		{#snippet right()}
			{#if g.badge}<Badge tone={g.badgeTone}>{g.badge}</Badge>{/if}
			<span class="addr-count">{g.count}</span>
		{/snippet}
		<div class="addr-cols">
			<span>{m.settings_address_col_address()}</span><span>{m.settings_address_col_used_by()}</span><span></span>
		</div>
		{#each g.rows as row (row.id)}
			<div class="addr-row">
				<a class="addr-main" href={href(row)}>
					<span class="addr-chip">
						{#if row.kind === 'shared'}<Icon icon={faUsers} size={15} />{:else}<Icon icon={faAt} size={15} />{/if}
					</span>
					<span class="addr-text">
						<span class="addr-title">
							<span class="addr-name">{row.title}</span>
							{#if row.isPrimary}<Badge tone="brand">{m.settings_address_primary()}</Badge>{/if}
							{#if row.rotationRequired}<Badge tone="warning" status>{m.settings_address_needs_new_key()}</Badge>{/if}
							{#if row.health === 'suspended'}<Badge tone="warning" status>{m.settings_address_suspended()}</Badge>{/if}
						</span>
						<span class="addr-mail">{row.email}</span>
						{#if row.signerSummary || row.forwardSummary || row.pendingSummary || row.health === 'suspended'}
							<span class="addr-sum">
								{#if row.health === 'suspended'}
									<span class="warn">
										<Icon icon={faCircleExclamation} size={12} />{m.settings_address_suspended_line({ domain: row.domain })}
									</span>
								{/if}
								{#if row.signerSummary}
									<span><Icon icon={faKey} size={12} />{row.signerSummary}</span>
								{/if}
								{#if row.forwardSummary}
									<span><Icon icon={faShare} size={12} />{row.forwardSummary}</span>
								{/if}
								{#if row.pendingSummary}
									<span class="pending"><Icon icon={faClock} size={12} />{row.pendingSummary}</span>
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
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon-sm" aria-label={m.settings_address_actions()}>
									<Icon icon={faEllipsis} size={16} />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item onSelect={() => open(row)}>
								<Icon icon={faArrowRight} size={15} />{m.common_open()}
							</DropdownMenu.Item>
							{#if row.canPromote}
								<DropdownMenu.Item onSelect={() => promote(row)}>
									<Icon icon={faStar} size={15} />{m.settings_address_make_primary()}
								</DropdownMenu.Item>
							{/if}
							{#if row.canRename}
								<DropdownMenu.Item onSelect={() => open(row)}>
									<Icon icon={faPenLine} size={15} />{m.settings_address_rename()}
								</DropdownMenu.Item>
							{/if}
							{#if row.canManagePeople}
								<DropdownMenu.Item onSelect={() => managePeople(row)}>
									<Icon icon={faUsers} size={15} />{m.settings_address_manage_people()}
								</DropdownMenu.Item>
							{/if}
							{#if row.canRemove}
								<DropdownMenu.Separator />
								<DropdownMenu.Item variant="danger" onSelect={() => askRemoval(row)}>
									<Icon icon={faTrashCan} size={15} />{m.settings_address_remove()}
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>
			{#if promoteFailedId === row.id}
				<div class="card-empty err" role="alert">{m.settings_address_promote_failed()}</div>
			{/if}
		{/each}
	</Card>
{/each}

{#if !addresses.loaded && addresses.error}
	<LoadState kind="error" label={addresses.error} onRetry={() => void addresses.load()} />
{:else if !addresses.loaded}
	<LoadState kind="loading" label={m.common_loading()} />
{:else if rows.length === 0}
	<p class="addr-note">{m.settings_address_empty()}</p>
{/if}

{#if roleKnown && !manage}
	<p class="addr-note">{m.settings_address_admin_only()}</p>
{/if}

{#if manage && !billing.canAddSharedAddresses}
	<div class="upgrade-list">
		<UpgradeNudge
			title={m.settings_address_nudge_paid_title()}
			desc={m.settings_address_nudge_paid_desc()}
		/>
	</div>
{:else if manage && !canAddMore}
	<div class="upgrade-list">
		<UpgradeNudge
			title={m.settings_address_nudge_shared_title({ domain: slotDomain })}
			desc={m.settings_address_nudge_shared_desc()}
		/>
	</div>
{/if}

{#if addresses.loaded && addresses.error}
	<p class="addr-note err">{addresses.error}</p>
{/if}
{#if workspaceAddresses.error}
	<p class="addr-note err">{workspaceAddresses.error}</p>
{/if}

{#if showCatchAll}
	<div class="addr-catchall"><CatchAllCard /></div>
{/if}

{#snippet removalBody()}
	<p class="dialog-p">{m.settings_address_remove_body()}</p>
{/snippet}

{#if pendingRemoval}
	<ConfirmDialog
		icon={faTrashCan}
		tone="danger"
		title={m.settings_address_remove_title()}
		sub={pendingRemoval.email}
		confirmLabel={m.settings_address_remove()}
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
