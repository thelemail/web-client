<script lang="ts">
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';
	import { cal } from '../state.svelte';

	const ROWS = [
		{
			key: 'work' as const,
			from: { name: 'Family', color: '#A87C3D' },
			to: { name: 'Thélème Co', color: '#3C6E8C' },
			both: false,
			reads: ['busy windows · no titles', 'encrypted for members'],
			caution: false
		},
		{
			key: 'school' as const,
			from: { name: 'school@meudon.fr', color: '#6E5B9E' },
			to: { name: 'Family', color: '#A87C3D' },
			both: false,
			reads: ['full details · both are yours'],
			caution: false
		},
		{
			key: 'gcal' as const,
			from: { name: 'My calendar', color: '#2E5440' },
			to: { name: 'Alex — Google', color: '#7E6BA8' },
			both: true,
			reads: ['busy windows leave Thelemail', 'this external calendar is readable by Google'],
			caution: true
		}
	];
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>From</Table.Head>
			<Table.Head></Table.Head>
			<Table.Head>To</Table.Head>
			<Table.Head>What the other side reads</Table.Head>
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
						{#each row.reads as read, i (read)}{#if i}<br />{/if}{read}{/each}
					</span>
				</Table.Cell>
				<Table.Cell>
					<Switch
						checked={cal.mirrors[row.key]}
						onCheckedChange={() => cal.toggleMirror(row.key)}
						aria-label="Mirror {row.from.name} to {row.to.name}"
					/>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
