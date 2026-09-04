<script lang="ts">
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Send from '@lucide/svelte/icons/send';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { cal } from '../state.svelte';

	const QUEUE = [
		{
			icon: PenLine,
			title: 'Moved “Design critique” to 15:00',
			sub: 'local · 10:02 · rev 4 · no conflict',
			state: 'queued',
			blocked: false
		},
		{
			icon: Send,
			title: 'RSVP yes — Quarterly access review',
			sub: 'iTIP REPLY to alex@meudon.fr · sends on reconnect',
			state: 'queued',
			blocked: false
		},
		{
			icon: TriangleAlert,
			title: 'Reschedule “Consultation — R. Panurge”',
			sub: 'organiser is Google Calendar · needs their accept',
			state: 'needs review',
			blocked: true
		}
	];

	const OWNERSHIP = [
		{ name: 'My calendar', color: '#2E5440', owner: 'Thelemail · zero-access', synced: 'local, always' },
		{ name: 'Family', color: '#A87C3D', owner: 'Thelemail · 4 members', synced: '10:02' },
		{
			name: 'bookings@thelema.co',
			color: '#4E8073',
			owner: 'Thelemail · role calendar',
			synced: '10:02'
		},
		{
			name: 'Alex — Google',
			color: '#7E6BA8',
			owner: 'Google · busy only',
			synced: '09:41 · readable by Google'
		}
	];
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<RefreshCw size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">Queue &amp; provenance</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body">
		<div class="sysbar" class:warn={cal.offline} class:info={!cal.offline}>
			{#if cal.offline}<CloudOff size={16} />{:else}<RefreshCw size={16} />{/if}
			<span>{cal.systemBarText}</span>
			<div class="grow"></div>
			<button type="button" class="sb-a" onclick={() => cal.toggleOffline()}>
				{cal.offline ? 'Reconnect now' : 'Simulate offline'}
			</button>
		</div>

		{#each QUEUE as entry (entry.title)}
			<div class="qrow">
				<span class="qi"><entry.icon size={16} /></span>
				<div>
					<div class="qt">{entry.title}</div>
					<div class="qs">{entry.sub}</div>
				</div>
				<span class="qstate" class:blocked={entry.blocked}>{entry.state}</span>
			</div>
		{/each}

		<div class="mtable-wrap">
			<div class="sp-eyebrow">Where each calendar actually lives</div>
			<div class="card">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Calendar</Table.Head>
							<Table.Head>Owner of record</Table.Head>
							<Table.Head>Last synced</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each OWNERSHIP as row (row.name)}
							<Table.Row>
								<Table.Cell>
									<span class="cal-nm2" style:--c={row.color}><i></i>{row.name}</span>
								</Table.Cell>
								<Table.Cell><span class="prov">{row.owner}</span></Table.Cell>
								<Table.Cell><span class="prov">{row.synced}</span></Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<span class="note">Every queued change is reversible before it leaves.</span>
		<div class="grow"></div>
		<Button variant="primary" onclick={() => (cal.dialog = null)}>Close</Button>
	</Dialog.Footer>
</Dialog.Content>
