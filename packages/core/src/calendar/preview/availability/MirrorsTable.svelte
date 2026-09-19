<script lang="ts">
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Switch } from '$core/components/ui/switch';
	import * as Table from '$core/components/ui/table';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	const ROWS = [
		{
			key: 'work' as const,
			from: { name: 'Family', color: '#A87C3D' },
			to: { name: 'Thélème Co', color: '#3C6E8C' },
			both: false,
			reads: () => [m.cal_mirrors_busy_no_titles(), m.cal_mirrors_encrypted_members()],
			caution: false
		},
		{
			key: 'school' as const,
			from: { name: 'school@meudon.fr', color: '#6E5B9E' },
			to: { name: 'Family', color: '#A87C3D' },
			both: false,
			reads: () => [m.cal_mirrors_full_details()],
			caution: false
		},
		{
			key: 'gcal' as const,
			from: { name: 'My calendar', color: '#2E5440' },
			to: { name: 'Alex — Google', color: '#7E6BA8' },
			both: true,
			reads: () => [m.cal_mirrors_busy_leave(), m.cal_mirrors_readable_google()],
			caution: true
		}
	];
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>{m.cal_mirrors_from()}</Table.Head>
			<Table.Head></Table.Head>
			<Table.Head>{m.cal_mirrors_to()}</Table.Head>
			<Table.Head>{m.cal_mirrors_reads()}</Table.Head>
			<Table.Head></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each ROWS as row (row.key)}
			<Table.Row>
				<Table.Cell>
					<span class="cal-nm2" style:--c={row.from.color}><i></i>{row.from.name}</span>
				</Table.Cell>
				<Table.Cell class="arrow">
					{#if row.both}<ArrowLeftRight size={15} />{:else}<ArrowRight size={15} />{/if}
				</Table.Cell>
				<Table.Cell>
					<span class="cal-nm2" style:--c={row.to.color}><i></i>{row.to.name}</span>
				</Table.Cell>
				<Table.Cell>
					<span class="prov" class:caution={row.caution}>
						{#each row.reads() as read, i (read)}{#if i}<br />{/if}{read}{/each}
					</span>
				</Table.Cell>
				<Table.Cell>
					<Switch
						checked={cal.mirrors[row.key]}
						onCheckedChange={() => cal.toggleMirror(row.key)}
						aria-label={m.cal_mirrors_toggle_aria({ from: row.from.name, to: row.to.name })}
					/>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
