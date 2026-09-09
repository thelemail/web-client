<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Send from '@lucide/svelte/icons/send';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import * as Table from '$core/components/ui/table';
	import type { OutboxRecord } from '../db';
	import { shortTime } from '../format';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';

	function iconFor(rec: OutboxRecord) {
		if (rec.status === 'blocked') return TriangleAlert;
		switch (rec.op.kind) {
			case 'item.put':
				return PenLine;
			case 'item.delete':
			case 'calendar.delete':
				return Trash2;
			case 'state.put':
				return UserCheck;
			case 'invite.send':
				return Send;
			default:
				return CalendarDays;
		}
	}

	function subFor(rec: OutboxRecord): string {
		const when = shortTime(new Date(rec.createdAt), cal.timeZone);
		if (rec.status === 'blocked') return `${when} · ${rec.lastError ?? 'changed elsewhere first'}`;
		if (rec.op.kind === 'item.put') return `local · ${when} · based on rev ${rec.op.body.baseRev}`;
		if (rec.op.kind === 'invite.send') {
			return `${rec.op.mail.method} to ${rec.op.mail.to.map((t) => t.address).join(', ')} · sends on reconnect`;
		}
		return `local · ${when}`;
	}

	function stateFor(rec: OutboxRecord): string {
		if (rec.status === 'blocked') return 'needs review';
		if (rec.status === 'sending') return 'sending';
		return rec.attempts ? `retrying (${rec.attempts})` : 'queued';
	}

	const ownership = $derived(
		calendarStore.calendars.map((c) => ({
			id: c.id,
			name: c.name,
			color: c.color,
			owner:
				c.kind === 'personal'
					? 'Thelemail · zero-access'
					: c.kind === 'role'
						? 'Thelemail · role calendar'
						: `Thelemail · ${c.row.memberCount} member${c.row.memberCount === 1 ? '' : 's'}`,
			synced: calendarStore.lastSyncAt
				? shortTime(new Date(calendarStore.lastSyncAt), cal.timeZone)
				: 'not yet'
		}))
	);
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<RefreshCw size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">Queue &amp; provenance</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body">
		<div class="sysbar" class:warn={cal.systemBarTone === 'warn'} class:info={cal.systemBarTone === 'info'}>
			{#if !calendarStore.online}<CloudOff size={16} />{:else}<RefreshCw size={16} />{/if}
			<span>{cal.systemBarText}</span>
			<div class="grow"></div>
			<button type="button" class="sb-a" onclick={() => calendarStore.flush()}>Send now</button>
		</div>

		{#if !calendarStore.queue.length}
			<div class="qrow">
				<span class="qi"><RefreshCw size={16} /></span>
				<div>
					<div class="qt">Nothing waiting</div>
					<div class="qs">Every change on this device has reached Thelemail.</div>
				</div>
			</div>
		{/if}

		{#each calendarStore.queue as entry (entry.seq)}
			{@const Icon = iconFor(entry)}
			<div class="qrow">
				<span class="qi"><Icon size={16} /></span>
				<div>
					<div class="qt">{entry.op.label}</div>
					<div class="qs">{subFor(entry)}</div>
					{#if entry.status === 'blocked'}
						<div class="qactions">
							<Button variant="secondary" size="sm" onclick={() => calendarStore.keepMine(entry.seq)}>
								Keep mine
							</Button>
							<Button variant="ghost" size="sm" onclick={() => calendarStore.takeTheirs(entry.seq)}>
								Take theirs
							</Button>
						</div>
					{:else}
						<div class="qactions">
							<Button variant="ghost" size="sm" onclick={() => calendarStore.discardOp(entry.seq)}>
								Discard
							</Button>
						</div>
					{/if}
				</div>
				<span class="qstate" class:blocked={entry.status === 'blocked'}>{stateFor(entry)}</span>
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
						{#each ownership as row (row.id)}
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
		<span class="note">Every queued change can be discarded before it leaves.</span>
		<div class="grow"></div>
		<Button variant="primary" onclick={() => (cal.dialog = null)}>Close</Button>
	</Dialog.Footer>
</Dialog.Content>
