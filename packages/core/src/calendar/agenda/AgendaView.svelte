<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Avatar from '$core/components/Avatar.svelte';
	import * as Popover from '$core/components/ui/popover';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { inboundLive, ownershipProven } from '$core/settings/domains/steps';
	import { SHARED_DOMAIN } from '$core/settings/entitlements';
	import { m } from '$paraglide/messages.js';
	import EventPopover from '../EventPopover.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';

	let openKey = $state<string | null>(null);

	const memberCount = $derived(workspaces.members.length);
	const domain = $derived(
		(customDomains.items.find(inboundLive) ?? customDomains.items.find(ownershipProven))?.domain ??
			SHARED_DOMAIN
	);
	const heroSub = $derived(
		memberCount > 1
			? m.cal_agenda_hero_team({ count: memberCount, domain })
			: m.cal_agenda_hero_solo()
	);
</script>

<div class="agpane">
	<div class="ag-inner">
		<div class="ag-hero">
			<div>
				<div class="agh-t">{m.cal_agenda_hero_title()}</div>
				<div class="agh-s">{heroSub}</div>
			</div>
			<div class="grow"></div>
			<PrivacyChip tone="private" label={m.cal_agenda_encrypted_members()} />
		</div>

		{#if !cal.agendaDays.length}
			<div class="ag-empty">{m.cal_agenda_empty({ period: cal.title.toLowerCase() })}</div>
		{/if}

		{#each cal.agendaDays as day (day.date)}
			<div class="ag-day">
				<div class="ag-date">
					<div class="d1">{day.dow}</div>
					<div class="d2">{day.num}</div>
					<div class="d3">{day.month}</div>
				</div>
				<div class="ag-list">
					{#each day.rows as row (row.key)}
						<div class="agrow" style:--c={row.color}>
							<div class="ag-tm">{row.time}</div>
							<Popover.Root
								open={openKey === row.key}
								onOpenChange={(next) => (openKey = next ? row.key : null)}
							>
								<Popover.Trigger>
									{#snippet child({ props })}
										<button {...props} type="button" class="ag-m">
											<div class="ag-t"><i class="dot"></i>{row.title}</div>
											<div class="ag-sub">{row.sub}</div>
										</button>
									{/snippet}
								</Popover.Trigger>
								<EventPopover selection={cal.describe(row.occ)} onClose={() => (openKey = null)} />
							</Popover.Root>
							<div class="ag-r">
								<span class="ownchip" class:none={!row.ownerName}>
									{#if row.ownerName}
										<Avatar initials={row.ownerInit} size={20} />
									{/if}{row.ownerLabel}
								</span>
								<button
									type="button"
									class="ackbtn"
									class:done={row.seen}
									onclick={() => cal.toggleAck(row.occ.item.id, row.seen)}
								>
									<Check size={13} />{row.seenLabel}
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
