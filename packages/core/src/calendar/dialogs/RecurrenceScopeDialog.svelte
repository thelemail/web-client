<script lang="ts">
	import Repeat from '@lucide/svelte/icons/repeat';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { untilBefore } from '../ics/write';
	import type { CalendarItem } from '../model';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import type { ScopeRequest } from '../types';

	interface Props {
		request: ScopeRequest;
	}

	let { request }: Props = $props();

	const verb = $derived(request.action === 'delete' ? 'Delete' : 'Edit');
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
				cal.notify(`Deleted every occurrence of “${occ.title}”`);
			} else if (scope === 'this' && occ.recurrenceId) {
				const next: CalendarItem = {
					...item,
					overrides: { ...(item.overrides ?? {}), [occ.recurrenceId]: { cancelled: true } }
				};
				await calendarStore.saveItem(next, { label: `Removed one occurrence of “${occ.title}”` });
				cal.notify('Removed this occurrence');
			} else if (scope === 'following' && item.rrule) {
				const next: CalendarItem = { ...item, rrule: untilBefore(item.rrule, occ.startWall, occ.allDay) };
				await calendarStore.saveItem(next, { label: `Ended “${occ.title}” before ${occ.startWall.slice(0, 10)}` });
				cal.notify('Ended the series before this occurrence');
			}
			cal.dialog = null;
			cal.scope = null;
		} catch (err) {
			cal.notify(err instanceof Error ? err.message : 'Could not change the series');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg cal-dlg-narrow" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<Repeat size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">{verb} a repeating {request.occ.item.kind}</Dialog.Title>
	</Dialog.Header>
	<div class="cal-dlg-body">
		<p class="cal-dlg-lead">
			“{request.occ.title}” repeats. Which occurrences should this {verb.toLowerCase()} touch?
		</p>
		<div class="scope-options">
			<Button variant="secondary" disabled={busy} onclick={() => apply('this')}>
				Only this occurrence
			</Button>
			{#if request.action === 'delete'}
				<Button variant="secondary" disabled={busy} onclick={() => apply('following')}>
					This and every later one
				</Button>
			{/if}
			<Button variant={request.action === 'delete' ? 'danger' : 'primary'} disabled={busy} onclick={() => apply('all')}>
				All occurrences
			</Button>
		</div>
	</div>
	<Dialog.Footer class="cal-dlg-foot">
		<span class="note">Guests are told about the change by mail once it is saved.</span>
		<div class="grow"></div>
		<Button variant="ghost" onclick={() => (cal.dialog = null)}>Cancel</Button>
	</Dialog.Footer>
</Dialog.Content>
