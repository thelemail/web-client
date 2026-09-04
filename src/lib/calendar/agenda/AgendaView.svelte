<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { MONTH_LABEL } from '../fixtures';
	import Avatar from '$lib/components/Avatar.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';
</script>

<div class="agpane">
	<div class="ag-inner">
		<div class="ag-hero">
			<div>
				<div class="agh-t">Every commitment has an owner.</div>
				<div class="agh-s">
					Shared across the four people behind <span class="mono">meudon.fr</span>. Owners are set by
					whoever creates the commitment; acknowledgement is per person and never inferred from
					opening the app.
				</div>
			</div>
			<div class="grow"></div>
			<PrivacyChip tone="private" label="Encrypted for members" />
		</div>

		{#each cal.agendaDays as day (day.num)}
			<div class="ag-day">
				<div class="ag-date">
					<div class="d1">{day.dow}</div>
					<div class="d2">{day.num}</div>
					<div class="d3">{MONTH_LABEL}</div>
				</div>
				<div class="ag-list">
					{#each day.rows as row (row.key)}
						<div class="agrow" style:--c={row.color}>
							<div class="ag-tm">{row.time}</div>
							<div class="ag-m">
								<div class="ag-t"><i class="dot"></i>{row.title}</div>
								<div class="ag-sub">{row.sub}</div>
							</div>
							<div class="ag-r">
								<span class="ownchip" class:none={!row.owner}>
									{#if row.owner}
										<Avatar
											initials={row.owner.init}
											size={20}
											bg={row.owner.bg}
											fg={row.owner.fg}
										/>
									{/if}{row.ownerLabel}
								</span>
								<button
									type="button"
									class="ackbtn"
									class:done={row.seen}
									onclick={() => cal.toggleAck(row.key, row.seen)}
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
