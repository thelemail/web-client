<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Avatar from '$core/components/Avatar.svelte';
	import * as Popover from '$core/components/ui/popover';
	import { customDomains } from '$core/stores/customDomains.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import EventPopover from '../EventPopover.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';

	let openKey = $state<string | null>(null);

	const memberCount = $derived(workspaces.members.length);
	const domain = $derived(customDomains.items[0]?.domain ?? 'thelemail.com');
	const heroSub = $derived(
		memberCount > 1
			? `Shared across the ${memberCount} people behind ${domain}. Owners are set by whoever creates the commitment; acknowledgement is per person and never inferred from opening the app.`
			: 'Every commitment can name an owner. Acknowledgement is per person and never inferred from opening the app.'
	);
</script>

<div class="agpane">
	<div class="ag-inner">
		<div class="ag-hero">
			<div>
				<div class="agh-t">Every commitment has an owner.</div>
				<div class="agh-s">{heroSub}</div>
			</div>
			<div class="grow"></div>
			<PrivacyChip tone="private" label="Encrypted for members" />
		</div>

		{#if !cal.agendaDays.length}
			<div class="ag-empty">Nothing scheduled for {cal.title.toLowerCase()}.</div>
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
