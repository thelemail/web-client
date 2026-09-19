<script lang="ts">
	import ClockArrowLeft from '@lucide/svelte/icons/clock-arrow-left';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { m } from '$paraglide/messages.js';
	import { dateLabel } from '../format';
	import { cal } from '../state.svelte';
	import { calendarStore, type RevisionView } from '../store.svelte';

	interface Props {
		request: { itemId: string };
	}

	let { request }: Props = $props();

	let revisions = $state<RevisionView[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let restoring = $state<number | null>(null);

	const current = $derived(calendarStore.items.get(request.itemId));

	$effect(() => {
		const id = request.itemId;
		loading = true;
		error = null;
		calendarStore
			.listRevisions(id)
			.then((rows) => {
				revisions = rows.sort((a, b) => b.rev - a.rev);
			})
			.catch((err) => {
				error = err instanceof Error ? err.message : m.cal_history_load_failed();
			})
			.finally(() => {
				loading = false;
			});
	});

	function whenOf(rev: RevisionView): string {
		return new Date(rev.createdAt).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function summaryOf(rev: RevisionView): string {
		if (rev.deleted) return m.cal_history_deleted();
		if (!rev.item) return m.cal_history_unreadable();
		const when = rev.item.start ?? rev.item.due;
		if (!when) return rev.item.kind === 'task' ? m.cal_history_no_due() : m.cal_history_unscheduled();
		const due = !rev.item.start;
		if ('date' in when) {
			const date = dateLabel(when.date, true);
			return due ? m.cal_history_due_date({ date }) : date;
		}
		const date = dateLabel(when.dateTime.slice(0, 10), true);
		const time = when.dateTime.slice(11, 16);
		return due ? m.cal_history_due_datetime({ date, time }) : m.cal_history_datetime({ date, time });
	}

	async function restore(rev: RevisionView) {
		restoring = rev.rev;
		error = null;
		try {
			await calendarStore.restoreRevision(request.itemId, rev.rev);
			cal.notify(m.cal_history_restored({ rev: rev.rev }));
			cal.dialog = null;
			cal.history = null;
		} catch (err) {
			error = err instanceof Error ? err.message : m.cal_history_restore_failed();
		} finally {
			restoring = null;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<ClockArrowLeft size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">{m.cal_history_title()}</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body">
		{#if current}
			<p class="cal-dlg-lead">{m.cal_history_lead({ title: current.item.title })}</p>
		{/if}

		{#if loading}
			<div class="qrow">
				<span class="qi"><ClockArrowLeft size={16} /></span>
				<div><div class="qt">{m.common_loading()}</div></div>
			</div>
		{:else if !revisions.length}
			<div class="qrow">
				<span class="qi"><ClockArrowLeft size={16} /></span>
				<div>
					<div class="qt">{m.cal_history_empty()}</div>
					<div class="qs">{m.cal_history_empty_desc()}</div>
				</div>
			</div>
		{/if}

		{#each revisions as rev (rev.rev)}
			{@const Icon = rev.deleted ? Trash2 : PenLine}
			{@const isCurrent = current?.rev === rev.rev}
			<div class="qrow">
				<span class="qi"><Icon size={16} /></span>
				<div>
					<div class="qt">{rev.item?.title ?? m.cal_history_sealed()}</div>
					<div class="qs">
						{m.cal_history_rev_line({
							rev: rev.rev,
							when: whenOf(rev),
							author: rev.mine ? m.cal_history_author_you() : m.cal_history_author_other(),
							summary: summaryOf(rev)
						})}
					</div>
					{#if !isCurrent && rev.item && !rev.deleted}
						<div class="qactions">
							<Button
								variant="secondary"
								size="sm"
								disabled={restoring !== null}
								onclick={() => restore(rev)}
							>
								{restoring === rev.rev ? m.cal_history_restoring() : m.cal_history_restore()}
							</Button>
						</div>
					{/if}
				</div>
				<span class="qstate">{isCurrent ? m.cal_history_state_current() : rev.deleted ? m.cal_history_state_deleted() : ''}</span>
			</div>
		{/each}

		{#if error}
			<div class="cal-notice">{error}</div>
		{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>{m.common_close()}</Button>
	</Dialog.Footer>
</Dialog.Content>
