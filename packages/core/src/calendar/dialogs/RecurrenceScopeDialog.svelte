<script lang="ts">
	import Repeat from '@lucide/svelte/icons/repeat';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { m } from '$paraglide/messages.js';
	import { untilBefore } from '../ics/write';
	import type { CalendarItem } from '../model';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import type { ScopeRequest } from '../types';

	interface Props {
		request: ScopeRequest;
	}

	let { request }: Props = $props();

	const kindLabel = $derived(
		request.occ.item.kind === 'task'
			? m.cal_kind_task_lower()
			: request.occ.item.kind === 'hold'
				? m.cal_kind_hold_lower()
				: m.cal_kind_event_lower()
	);
	let busy = $state(false);

	async function apply(scope: 'this' | 'following' | 'all') {
		const occ = request.occ;
		const item = occ.item;
		if (request.action === 'edit') {
			cal.dialog = null;
			cal.scope = null;
			cal.openEditor({ mode: 'edit', occ, item, scope: scope === 'all' ? 'all' : 'this' });
			return;
		}
		busy = true;
		try {
			if (scope === 'all') {
				await calendarStore.deleteItem(item.id);
				cal.notify(m.cal_scope_deleted_all({ title: occ.title }));
			} else if (scope === 'this' && occ.recurrenceId) {
				const next: CalendarItem = {
					...item,
					overrides: { ...(item.overrides ?? {}), [occ.recurrenceId]: { cancelled: true } }
				};
				await calendarStore.saveItem(next, { label: `Removed one occurrence of “${occ.title}”` });
				cal.notify(m.cal_scope_removed_one());
			} else if (scope === 'following' && item.rrule) {
				const next: CalendarItem = { ...item, rrule: untilBefore(item.rrule, occ.startWall, occ.allDay) };
				await calendarStore.saveItem(next, { label: `Ended “${occ.title}” before ${occ.startWall.slice(0, 10)}` });
				cal.notify(m.cal_scope_ended_series());
			}
			cal.dialog = null;
			cal.scope = null;
		} catch (err) {
			cal.notify(err instanceof Error ? err.message : m.cal_scope_failed());
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg cal-dlg-narrow" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<Repeat size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">
			{request.action === 'delete'
				? m.cal_scope_title_delete({ kind: kindLabel })
				: m.cal_scope_title_edit({ kind: kindLabel })}
		</Dialog.Title>
	</Dialog.Header>
	<div class="cal-dlg-body">
		<p class="cal-dlg-lead">
			{request.action === 'delete'
				? m.cal_scope_lead_delete({ title: request.occ.title })
				: m.cal_scope_lead_edit({ title: request.occ.title })}
		</p>
		<div class="scope-options">
			<Button variant="secondary" disabled={busy} onclick={() => apply('this')}>
				{m.cal_scope_only_this()}
			</Button>
			{#if request.action === 'delete'}
				<Button variant="secondary" disabled={busy} onclick={() => apply('following')}>
					{m.cal_scope_following()}
				</Button>
			{/if}
			<Button variant={request.action === 'delete' ? 'danger' : 'primary'} disabled={busy} onclick={() => apply('all')}>
				{m.cal_scope_all()}
			</Button>
		</div>
	</div>
	<Dialog.Footer class="cal-dlg-foot">
		<span class="note">{m.cal_scope_guests_note()}</span>
		<div class="grow"></div>
		<Button variant="ghost" onclick={() => (cal.dialog = null)}>{m.common_cancel()}</Button>
	</Dialog.Footer>
</Dialog.Content>
