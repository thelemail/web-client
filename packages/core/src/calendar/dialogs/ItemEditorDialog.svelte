<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import GuestField from '../editor/GuestField.svelte';
	import RecurrenceEditor from '../editor/RecurrenceEditor.svelte';
	import { rruleSummary } from '../ics/write';
	import { identityFor, invitationChanged, myAddressList, sendCancellation, sendInvitations } from '../invite';
	import {
		ITEM_SCHEMA_VERSION,
		isAllDay,
		newUid,
		type Attendee,
		type CalendarItem,
		type ItemKind,
		type OverridePatch,
		type Privacy,
		type Reminder,
		type WhenValue
	} from '../model';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import { deviceTimeZone, instantToWall, supportedTimeZones, addMinutesWall } from '../tz';
	import type { BoundaryLine, EditorRequest } from '../types';

	interface Props {
		request: EditorRequest;
	}

	let { request }: Props = $props();

	const REMINDER_PRESETS = [
		[0, 'At the time'],
		[5, '5 minutes before'],
		[10, '10 minutes before'],
		[15, '15 minutes before'],
		[30, '30 minutes before'],
		[60, '1 hour before'],
		[120, '2 hours before'],
		[1440, '1 day before']
	] as const;

	const source = $derived(request.item ?? request.occ?.item ?? null);
	const isEdit = $derived(request.mode === 'edit' && !!source);
	const thisOnly = $derived(isEdit && request.scope === 'this' && !!request.occ?.recurrenceId);

	let kind = $state<ItemKind>('event');
	let calendarId = $state('');
	let title = $state('');
	let allDay = $state(false);
	let startDate = $state('');
	let startTime = $state('09:00');
	let endDate = $state('');
	let endTime = $state('10:00');
	let timeZone = $state(deviceTimeZone());
	let floating = $state(false);
	let rrule = $state<string | undefined>(undefined);
	let location = $state('');
	let videoUrl = $state('');
	let notes = $state('');
	let attendees = $state<Attendee[]>([]);
	let privacy = $state<Privacy>('busy');
	let reminders = $state<number[]>([]);
	let reminderPick = $state('');
	let scheduled = $state(false);
	let dueDate = $state('');
	let dueTime = $state('');
	let estimate = $state('');
	let ownerEmail = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let seeded = false;

	function wallOf(w: WhenValue | undefined, tz: string): { date: string; time: string; allDay: boolean } {
		if (!w) return { date: cal.today, time: '09:00', allDay: false };
		if (isAllDay(w)) return { date: w.date, time: '', allDay: true };
		return { date: w.dateTime.slice(0, 10), time: w.dateTime.slice(11, 16), allDay: false };
	}

	$effect(() => {
		if (seeded) return;
		seeded = true;
		const s = source;
		if (s) {
			kind = s.kind;
			calendarId = s.calendarId;
			title = request.mode === 'duplicate' ? `${s.title} (copy)` : s.title;
			location = s.location ?? '';
			videoUrl = s.videoUrl ?? '';
			notes = s.notes ?? '';
			attendees = [...(s.attendees ?? [])];
			privacy = s.privacy;
			reminders = (s.reminders ?? []).map((r) => r.minutesBefore);
			rrule = thisOnly ? undefined : s.rrule;
			const occ = request.occ;
			const start = thisOnly && occ ? (occ.allDay ? { date: occ.startWall } : { dateTime: occ.startWall, timeZone: occ.timeZone }) : s.start;
			const end = thisOnly && occ ? (occ.allDay ? { date: occ.endWall } : { dateTime: occ.endWall, timeZone: occ.timeZone }) : s.end;
			if (start && !isAllDay(start)) {
				floating = !start.timeZone;
				timeZone = start.timeZone ?? deviceTimeZone();
			}
			const sw = wallOf(start, timeZone);
			const ew = wallOf(end, timeZone);
			allDay = sw.allDay;
			startDate = sw.date;
			startTime = sw.time || '09:00';
			endDate = ew.date;
			endTime = ew.time || '10:00';
			scheduled = !!s.start;
			if (s.due) {
				const d = wallOf(s.due, timeZone);
				dueDate = d.date;
				dueTime = d.time;
			}
			estimate = s.estimateMinutes ? String(s.estimateMinutes) : '';
			ownerEmail = s.owner?.email ?? '';
			if (thisOnly && occ) {
				title = occ.title;
				location = occ.location ?? '';
				videoUrl = occ.videoUrl ?? '';
				notes = occ.notes ?? '';
			}
			return;
		}
		kind = request.kind ?? 'event';
		calendarId = calendarStore.defaultCalendar?.id ?? '';
		privacy = kind === 'hold' ? 'busy' : calendarStore.defaultPrivacy(calendarId);
		const pre = request.prefill;
		if (pre?.startWall) {
			startDate = pre.startWall.slice(0, 10);
			startTime = pre.startWall.slice(11, 16);
			endDate = (pre.endWall ?? addMinutesWall(pre.startWall, 60)).slice(0, 10);
			endTime = (pre.endWall ?? addMinutesWall(pre.startWall, 60)).slice(11, 16);
		} else {
			const base = pre?.date ?? cal.today;
			const nowWall = instantToWall(new Date(), timeZone);
			const startWall = addMinutesWall(`${base}T${nowWall.slice(11, 13)}:00`, 60);
			const endWall = addMinutesWall(startWall, 60);
			startDate = startWall.slice(0, 10);
			startTime = startWall.slice(11, 16);
			endDate = endWall.slice(0, 10);
			endTime = endWall.slice(11, 16);
		}
		if (pre?.title) title = pre.title;
		if (pre?.notes) notes = pre.notes;
		if (pre?.attendees) attendees = [...pre.attendees];
		scheduled = kind !== 'task';
		dueDate = pre?.date ?? cal.today;
		ownerEmail = kind === 'task' ? (auth.email ?? '') : '';
		const fallback = accountSettings.calendar.defaultReminderMinutes;
		reminders = kind === 'event' && fallback !== null ? [fallback] : [];
	});

	const calendar = $derived(calendarStore.calendar(calendarId));
	const writable = $derived(calendarStore.writableCalendars);
	const members = $derived(workspaces.members);
	const zones = $derived(supportedTimeZones());
	const identity = $derived(source && source.organizer ? source.organizer : identityFor({ calendarId } as CalendarItem));
	const externalCount = $derived(attendees.filter((a) => !a.internal).length);

	const boundary = $derived.by((): BoundaryLine[] => {
		const lines: BoundaryLine[] = [];
		if (kind === 'hold') {
			lines.push({ tone: 'yes', text: 'A busy window only. The title stays on your devices.' });
		} else {
			lines.push({
				tone: 'yes',
				text: calendar?.kind === 'personal' ? 'Title, notes and guests are sealed to your key.' : `Title, notes and guests are sealed for ${calendar?.name ?? 'the calendar'} members.`
			});
		}
		if (privacy === 'private') lines.push({ tone: 'no', text: 'No busy window leaves this device.' });
		else lines.push({ tone: 'warn', text: 'The start and end of each occurrence are sent so your workspace can see you are busy.', mono: 'server reads: start, end' });
		if (attendees.length) {
			lines.push({
				tone: externalCount ? 'warn' : 'yes',
				text: externalCount
					? `Title, time and location go by mail to ${externalCount} guest${externalCount === 1 ? '' : 's'} outside your workspace, sealed when they use Thelemail.`
					: 'Invitations travel as encrypted mail between Thelemail members.',
				mono: `from: ${identity.email}`
			});
		}
		return lines;
	});

	function whenValues(): { start?: WhenValue; end?: WhenValue } {
		if (kind === 'task' && !scheduled) return {};
		if (allDay) return { start: { date: startDate }, end: { date: endDate < startDate ? startDate : endDate } };
		const tz = floating ? undefined : timeZone;
		let start = `${startDate}T${startTime}:00`;
		let end = `${endDate || startDate}T${endTime}:00`;
		if (end <= start) end = addMinutesWall(start, 30);
		return { start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz } };
	}

	function addReminder() {
		const minutes = Number(reminderPick);
		if (!Number.isFinite(minutes) || reminderPick === '') return;
		if (!reminders.includes(minutes)) reminders = [...reminders, minutes].sort((a, b) => a - b);
		reminderPick = '';
	}

	function reminderLabel(m: number): string {
		return REMINDER_PRESETS.find(([v]) => v === m)?.[1] ?? `${m} minutes before`;
	}

	function buildItem(): CalendarItem {
		const base = source && request.mode !== 'duplicate' ? source : null;
		const id = base?.id ?? crypto.randomUUID();
		const now = new Date().toISOString();
		const when = whenValues();
		const ownerMember = members.find((m) => m.email.toLowerCase() === ownerEmail.toLowerCase());
		const item: CalendarItem = {
			schemaVersion: ITEM_SCHEMA_VERSION,
			id,
			kind,
			calendarId,
			title: kind === 'hold' ? title.trim() || 'Busy' : title.trim(),
			notes: kind === 'hold' ? undefined : notes.trim() || undefined,
			location: kind === 'hold' ? undefined : location.trim() || undefined,
			videoUrl: kind === 'hold' ? undefined : videoUrl.trim() || undefined,
			start: when.start,
			end: when.end,
			rrule: kind === 'task' ? undefined : rrule,
			exdates: base?.exdates,
			overrides: base?.overrides,
			organizer: kind === 'event' && attendees.length ? { email: identity.email, name: identity.name, internal: true } : base?.organizer,
			attendees: kind === 'event' && attendees.length ? attendees : undefined,
			owner: kind === 'task' && ownerEmail ? { accountId: ownerMember?.accountId, email: ownerEmail, name: ownerMember?.fullName } : undefined,
			due: kind === 'task' && dueDate ? (dueTime ? { dateTime: `${dueDate}T${dueTime}:00`, timeZone } : { date: dueDate }) : undefined,
			estimateMinutes: kind === 'task' && estimate ? Math.max(0, Number(estimate)) : undefined,
			done: kind === 'task' ? (base?.done ?? false) : undefined,
			rolloverCount: base?.rolloverCount,
			privacy: kind === 'hold' && privacy === 'shared' ? 'busy' : privacy,
			sourceMessageId: base?.sourceMessageId ?? request.prefill?.sourceMessageId,
			threadSubject: base?.threadSubject ?? request.prefill?.threadSubject,
			reminders: reminders.length ? reminders.map((m): Reminder => ({ minutesBefore: m })) : undefined,
			uid: base?.uid ?? newUid(id, (auth.email ?? 'x@thelemail.com').split('@')[1] ?? 'thelemail.com'),
			sequence: base ? base.sequence + (invitationChanged(base, { ...base, title, start: when.start, end: when.end } as CalendarItem) ? 1 : 0) : 0,
			createdAt: base?.createdAt ?? now,
			updatedAt: now
		};
		return item;
	}

	function buildOverride(): CalendarItem {
		if (!source || !request.occ?.recurrenceId) throw new Error('No occurrence to edit');
		const when = whenValues();
		const patch: OverridePatch = {
			title: title.trim(),
			notes: notes.trim() || undefined,
			location: location.trim() || undefined,
			videoUrl: videoUrl.trim() || undefined,
			start: when.start,
			end: when.end,
			attendees: attendees.length ? attendees : undefined,
			reminders: reminders.length ? reminders.map((m) => ({ minutesBefore: m })) : undefined
		};
		return { ...source, overrides: { ...(source.overrides ?? {}), [request.occ.recurrenceId]: patch }, updatedAt: new Date().toISOString() };
	}

	async function save() {
		error = null;
		if (!calendarId) {
			error = 'Pick a calendar';
			return;
		}
		if (kind !== 'hold' && !title.trim()) {
			error = 'Give it a title';
			return;
		}
		if ((kind !== 'task' || scheduled) && !startDate) {
			error = 'Pick a date';
			return;
		}
		busy = true;
		try {
			const previous = isEdit ? source ?? undefined : undefined;
			const next = thisOnly ? buildOverride() : buildItem();
			await calendarStore.saveItem(next, { label: `${isEdit ? 'Edited' : 'Created'} “${next.title || 'untitled'}”` });
			if (kind === 'event') {
				const removedAll = previous && (previous.attendees?.length ?? 0) > 0 && !next.attendees?.length;
				if (removedAll && previous) await sendCancellation(previous);
				else if (next.attendees?.length && (!previous || invitationChanged(previous, next))) {
					await sendInvitations(next, previous, thisOnly ? request.occ : undefined);
				}
			}
			cal.notify(isEdit ? 'Saved' : kind === 'task' ? 'Task added' : kind === 'hold' ? 'Hold placed' : attendees.length ? 'Saved · invitations queued' : 'Event added');
			cal.closeEditor();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		{#if kind === 'task'}<ListTodo size={18} color="var(--brass-600)" />{:else if kind === 'hold'}<Lock size={18} color="var(--brass-600)" />{:else}<CalendarDays size={18} color="var(--brass-600)" />{/if}
		<Dialog.Title class="dt">
			{isEdit ? 'Edit' : request.mode === 'duplicate' ? 'Duplicate' : 'New'}
			{kind === 'task' ? 'task' : kind === 'hold' ? 'hold' : 'event'}{thisOnly ? ' · this occurrence only' : ''}
		</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body cal-form">
		{#if !isEdit}
			<div class="seg kind-seg">
				<button type="button" class:on={kind === 'event'} onclick={() => (kind = 'event')}>Event</button>
				<button type="button" class:on={kind === 'task'} onclick={() => ((kind = 'task'), (scheduled = false))}>Task</button>
				<button type="button" class:on={kind === 'hold'} onclick={() => ((kind = 'hold'), (privacy = privacy === 'shared' ? 'busy' : privacy))}>Hold</button>
			</div>
		{/if}

		<label class="cal-field">
			<span>{kind === 'hold' ? 'Label (stays on your devices)' : 'Title'}</span>
			<input type="text" bind:value={title} maxlength="200" placeholder={kind === 'hold' ? 'Busy' : kind === 'task' ? 'What needs doing' : 'What is happening'} />
		</label>

		<label class="cal-field">
			<span>Calendar</span>
			<select bind:value={calendarId} disabled={isEdit && !!source?.attendees?.length}>
				{#each writable as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</label>

		{#if kind === 'task'}
			<div class="cal-field two">
				<label>
					<span>Due date</span>
					<input type="date" bind:value={dueDate} />
				</label>
				<label>
					<span>Time</span>
					<input type="time" bind:value={dueTime} />
				</label>
			</div>
			<div class="cal-field two">
				<label>
					<span>Estimate (minutes)</span>
					<input type="number" min="0" step="5" bind:value={estimate} placeholder="30" />
				</label>
				<label>
					<span>Owner</span>
					<select bind:value={ownerEmail}>
						<option value="">Unassigned</option>
						{#each members as m (m.accountId)}
							<option value={m.email}>{m.fullName || m.email}</option>
						{/each}
					</select>
				</label>
			</div>
			<label class="cal-check">
				<input type="checkbox" bind:checked={scheduled} />
				Timebox it on the grid
			</label>
		{/if}

		{#if kind !== 'task' || scheduled}
			<div class="cal-field two">
				<label>
					<span>Starts</span>
					<input type="date" bind:value={startDate} onchange={() => { if (!endDate || endDate < startDate) endDate = startDate; }} />
				</label>
				{#if !allDay}
					<label>
						<span>&nbsp;</span>
						<input type="time" bind:value={startTime} />
					</label>
				{/if}
			</div>
			<div class="cal-field two">
				<label>
					<span>Ends</span>
					<input type="date" bind:value={endDate} min={startDate} />
				</label>
				{#if !allDay}
					<label>
						<span>&nbsp;</span>
						<input type="time" bind:value={endTime} />
					</label>
				{/if}
			</div>
			<div class="cal-inline">
				<label class="cal-check"><input type="checkbox" bind:checked={allDay} />All day</label>
				{#if !allDay}
					<label class="cal-check"><input type="checkbox" bind:checked={floating} />Floating time</label>
					{#if !floating}
						<select class="tz" bind:value={timeZone} aria-label="Time zone">
							{#each zones as z (z)}
								<option value={z}>{z}</option>
							{/each}
						</select>
					{/if}
				{/if}
			</div>
			{#if kind !== 'task' && !thisOnly}
				<div class="cal-field">
					<span>Repeats · {rruleSummary(rrule)}</span>
					<RecurrenceEditor value={rrule} {startDate} onChange={(v) => (rrule = v)} />
				</div>
			{/if}
		{/if}

		{#if kind === 'event'}
			<div class="cal-field">
				<span>Guests</span>
				<GuestField value={attendees} exclude={myAddressList()} onChange={(next) => (attendees = next)} />
			</div>
			<div class="cal-field two">
				<label>
					<span>Location</span>
					<input type="text" bind:value={location} maxlength="240" placeholder="Where" />
				</label>
				<label>
					<span>Video link</span>
					<input type="url" bind:value={videoUrl} maxlength="500" placeholder="https://" />
				</label>
			</div>
		{/if}

		{#if kind !== 'hold'}
			<label class="cal-field">
				<span>Notes</span>
				<textarea rows="3" bind:value={notes} maxlength="8000"></textarea>
			</label>
		{/if}

		<div class="cal-field">
			<span>Reminders</span>
			<div class="reminders">
				{#each reminders as m (m)}
					<span class="guest-chip">
						{reminderLabel(m)}
						<button type="button" aria-label="Remove reminder" onclick={() => (reminders = reminders.filter((x) => x !== m))}>×</button>
					</span>
				{/each}
				<select bind:value={reminderPick} onchange={addReminder} aria-label="Add a reminder">
					<option value="">Add…</option>
					{#each REMINDER_PRESETS as [value, label] (value)}
						<option value={String(value)}>{label}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="cal-field">
			<span>Who can see it is busy</span>
			<div class="seg">
				<button type="button" class:on={privacy === 'private'} onclick={() => (privacy = 'private')}>Private</button>
				<button type="button" class:on={privacy === 'busy'} onclick={() => (privacy = 'busy')}>Busy-only</button>
				{#if kind !== 'hold'}
					<button type="button" class:on={privacy === 'shared'} onclick={() => (privacy = 'shared')}>Shared</button>
				{/if}
			</div>
		</div>

		<DisclosureBoundary heading="What leaves this device" headingIcon={ShieldCheck} lines={boundary} />

		{#if error}<div class="cal-error" role="alert">{error}</div>{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<span class="note">{calendarStore.online ? 'Saved to Thelemail as soon as you confirm.' : 'Offline — saved here and sent when you reconnect.'}</span>
		<div class="grow"></div>
		<Button variant="ghost" disabled={busy} onclick={() => cal.closeEditor()}>Cancel</Button>
		<Button variant="primary" disabled={busy} onclick={save}>{isEdit ? 'Save' : 'Add'}</Button>
	</Dialog.Footer>
</Dialog.Content>
