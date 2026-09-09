<script lang="ts">
	import ClockArrowLeft from '@lucide/svelte/icons/clock-arrow-left';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
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
				error = err instanceof Error ? err.message : 'Could not load the history';
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
		if (rev.deleted) return 'Deleted';
		if (!rev.item) return 'Cannot open this revision on this device';
		const when = rev.item.start ?? rev.item.due;
		if (!when) return rev.item.kind === 'task' ? 'No due date' : 'Unscheduled';
		const prefix = rev.item.start ? '' : 'Due ';
		if ('date' in when) return `${prefix}${dateLabel(when.date, true)}`;
		return `${prefix}${dateLabel(when.dateTime.slice(0, 10), true)} · ${when.dateTime.slice(11, 16)}`;
	}

	async function restore(rev: RevisionView) {
		restoring = rev.rev;
		error = null;
		try {
			await calendarStore.restoreRevision(request.itemId, rev.rev);
			cal.notify(`Restored revision ${rev.rev}`);
			cal.dialog = null;
			cal.history = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not restore that revision';
		} finally {
			restoring = null;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<ClockArrowLeft size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">History</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body">
		{#if current}
			<p class="cal-dlg-lead">
				Every saved version of “{current.item.title}” stays sealed on Thelemail. Restoring one makes
				a new revision; nothing is overwritten.
			</p>
		{/if}

		{#if loading}
			<div class="qrow">
				<span class="qi"><ClockArrowLeft size={16} /></span>
				<div><div class="qt">Loading…</div></div>
			</div>
		{:else if !revisions.length}
			<div class="qrow">
				<span class="qi"><ClockArrowLeft size={16} /></span>
				<div>
					<div class="qt">No history yet</div>
					<div class="qs">Older versions appear here once the item has been edited.</div>
				</div>
			</div>
		{/if}

		{#each revisions as rev (rev.rev)}
			{@const Icon = rev.deleted ? Trash2 : PenLine}
			{@const isCurrent = current?.rev === rev.rev}
			<div class="qrow">
				<span class="qi"><Icon size={16} /></span>
				<div>
					<div class="qt">{rev.item?.title ?? '(sealed)'}</div>
					<div class="qs">
						Revision {rev.rev} · {whenOf(rev)} · {rev.mine ? 'you' : 'another member'} ·
						{summaryOf(rev)}
					</div>
					{#if !isCurrent && rev.item && !rev.deleted}
						<div class="qactions">
							<Button
								variant="secondary"
								size="sm"
								disabled={restoring !== null}
								onclick={() => restore(rev)}
							>
								{restoring === rev.rev ? 'Restoring…' : 'Restore this version'}
							</Button>
						</div>
					{/if}
				</div>
				<span class="qstate">{isCurrent ? 'current' : rev.deleted ? 'deleted' : ''}</span>
			</div>
		{/each}

		{#if error}
			<div class="cal-notice">{error}</div>
		{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>Close</Button>
	</Dialog.Footer>
</Dialog.Content>
