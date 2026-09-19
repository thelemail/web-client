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
	import { m } from '$paraglide/messages.js';
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
		if (rec.status === 'blocked') {
			return m.cal_queue_sub_blocked({ when, error: rec.lastError ?? m.cal_queue_changed_elsewhere() });
		}
		if (rec.op.kind === 'item.put') return m.cal_queue_sub_put({ when, rev: rec.op.body.baseRev });
		if (rec.op.kind === 'invite.send') {
			return m.cal_queue_sub_invite({
				method: rec.op.mail.method,
				recipients: rec.op.mail.to.map((t) => t.address).join(', ')
			});
		}
		return m.cal_queue_sub_local({ when });
	}

	function stateFor(rec: OutboxRecord): string {
		if (rec.status === 'blocked') return m.cal_queue_state_review();
		if (rec.status === 'sending') return m.cal_queue_state_sending();
		return rec.attempts ? m.cal_queue_state_retrying({ attempts: rec.attempts }) : m.cal_queue_state_queued();
	}

	const ownership = $derived(
		calendarStore.calendars.map((c) => ({
			id: c.id,
			name: c.name,
			color: c.color,
			owner:
				c.kind === 'personal'
					? m.cal_queue_owner_personal()
					: c.kind === 'role'
						? m.cal_queue_owner_role()
						: m.cal_queue_owner_shared({ count: c.row.memberCount }),
			synced: calendarStore.lastSyncAt
				? shortTime(new Date(calendarStore.lastSyncAt), cal.timeZone)
				: m.cal_queue_not_synced()
		}))
	);
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<RefreshCw size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">{m.cal_queue_title()}</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body">
		<div class="sysbar" class:warn={cal.systemBarTone === 'warn'} class:info={cal.systemBarTone === 'info'}>
			{#if !calendarStore.online}<CloudOff size={16} />{:else}<RefreshCw size={16} />{/if}
			<span>{cal.systemBarText}</span>
			<div class="grow"></div>
			<button type="button" class="sb-a" onclick={() => calendarStore.flush()}>{m.cal_queue_send_now()}</button>
		</div>

		{#if !calendarStore.queue.length}
			<div class="qrow">
				<span class="qi"><RefreshCw size={16} /></span>
				<div>
					<div class="qt">{m.cal_queue_empty()}</div>
					<div class="qs">{m.cal_queue_empty_desc()}</div>
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
								{m.cal_queue_keep_mine()}
							</Button>
							<Button variant="ghost" size="sm" onclick={() => calendarStore.takeTheirs(entry.seq)}>
								{m.cal_queue_take_theirs()}
							</Button>
						</div>
					{:else}
						<div class="qactions">
							<Button variant="ghost" size="sm" onclick={() => calendarStore.discardOp(entry.seq)}>
								{m.cal_queue_discard()}
							</Button>
						</div>
					{/if}
				</div>
				<span class="qstate" class:blocked={entry.status === 'blocked'}>{stateFor(entry)}</span>
			</div>
		{/each}

		<div class="mtable-wrap">
			<div class="sp-eyebrow">{m.cal_queue_where()}</div>
			<div class="card">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.cal_queue_col_calendar()}</Table.Head>
							<Table.Head>{m.cal_queue_col_owner()}</Table.Head>
							<Table.Head>{m.cal_queue_col_synced()}</Table.Head>
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
		<span class="note">{m.cal_queue_note()}</span>
		<div class="grow"></div>
		<Button variant="primary" onclick={() => (cal.dialog = null)}>{m.common_close()}</Button>
	</Dialog.Footer>
</Dialog.Content>
