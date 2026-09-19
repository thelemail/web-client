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
	import { m } from '$paraglide/messages.js';
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

	const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

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
	const kindLabel = $derived(
		kind === 'task' ? m.cal_kind_task_lower() : kind === 'hold' ? m.cal_kind_hold_lower() : m.cal_kind_event_lower()
	);
	const dialogTitle = $derived(
		isEdit
			? m.cal_editor_title_edit({ kind: kindLabel })
			: request.mode === 'duplicate'
				? m.cal_editor_title_duplicate({ kind: kindLabel })
				: m.cal_editor_title_new({ kind: kindLabel })
	);

	const boundary = $derived.by((): BoundaryLine[] => {
		const lines: BoundaryLine[] = [];
		if (kind === 'hold') {
			lines.push({ tone: 'yes', text: m.cal_editor_hold_sealed() });
		} else {
			lines.push({
				tone: 'yes',
				text:
					calendar?.kind === 'personal'
						? m.cal_editor_sealed_personal()
						: m.cal_editor_sealed_members({ calendar: calendar?.name ?? m.cal_editor_the_calendar() })
			});
		}
		if (privacy === 'private') lines.push({ tone: 'no', text: m.cal_editor_private_line() });
		else lines.push({ tone: 'warn', text: m.cal_editor_busy_line(), mono: m.cal_editor_server_reads() });
		if (attendees.length) {
			lines.push({
				tone: externalCount ? 'warn' : 'yes',
				text: externalCount
					? m.cal_editor_external_guests({ count: externalCount })
					: m.cal_editor_internal_guests(),
				mono: m.cal_editor_from({ email: identity.email })
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

	function reminderLabel(minutes: number): string {
		if (minutes === 0) return m.cal_reminder_at_time();
		if (minutes === 1440) return m.cal_reminder_days_before({ count: 1 });
		if (minutes === 60 || minutes === 120) return m.cal_reminder_hours_before({ count: minutes / 60 });
		return m.cal_reminder_minutes_before({ count: minutes });
	}

	function buildItem(): CalendarItem {
		const base = source && request.mode !== 'duplicate' ? source : null;
		const id = base?.id ?? crypto.randomUUID();
		const now = new Date().toISOString();
		const when = whenValues();
		const ownerMember = members.find((member) => member.email.toLowerCase() === ownerEmail.toLowerCase());
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
			reminders: reminders.length ? reminders.map((minutes): Reminder => ({ minutesBefore: minutes })) : undefined,
			uid: base?.uid ?? newUid(id, (auth.email ?? 'x@thelemail.com').split('@')[1] ?? 'thelemail.com'),
			sequence: base ? base.sequence + (invitationChanged(base, { ...base, title, start: when.start, end: when.end } as CalendarItem) ? 1 : 0) : 0,
			createdAt: base?.createdAt ?? now,
			updatedAt: now
		};
		return item;
	}

	function buildOverride(): CalendarItem {
		if (!source || !request.occ?.recurrenceId) throw new Error(m.cal_editor_no_occurrence());
		const when = whenValues();
		const patch: OverridePatch = {
			title: title.trim(),
			notes: notes.trim() || undefined,
			location: location.trim() || undefined,
			videoUrl: videoUrl.trim() || undefined,
			start: when.start,
			end: when.end,
			attendees: attendees.length ? attendees : undefined,
			reminders: reminders.length ? reminders.map((minutes) => ({ minutesBefore: minutes })) : undefined
		};
		return { ...source, overrides: { ...(source.overrides ?? {}), [request.occ.recurrenceId]: patch }, updatedAt: new Date().toISOString() };
	}

	async function save() {
		error = null;
		if (!calendarId) {
			error = m.cal_editor_pick_calendar();
			return;
		}
		if (kind !== 'hold' && !title.trim()) {
			error = m.cal_editor_title_required();
			return;
		}
		if ((kind !== 'task' || scheduled) && !startDate) {
			error = m.cal_editor_pick_date();
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
			cal.notify(
				isEdit
					? m.cal_editor_saved()
					: kind === 'task'
						? m.cal_editor_task_added()
						: kind === 'hold'
							? m.cal_editor_hold_placed()
							: attendees.length
								? m.cal_editor_saved_invites()
								: m.cal_editor_event_added()
			);
			cal.closeEditor();
		} catch (err) {
			error = err instanceof Error ? err.message : m.cal_editor_save_failed();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Content class="cal-surface cal-dlg" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		{#if kind === 'task'}<ListTodo size={18} color="var(--brass-600)" />{:else if kind === 'hold'}<Lock size={18} color="var(--brass-600)" />{:else}<CalendarDays size={18} color="var(--brass-600)" />{/if}
		<Dialog.Title class="dt">
			{thisOnly ? m.cal_editor_title_this_only({ title: dialogTitle }) : dialogTitle}
		</Dialog.Title>
	</Dialog.Header>

	<div class="cal-dlg-body cal-form">
		{#if !isEdit}
			<div class="seg kind-seg">
				<button type="button" class:on={kind === 'event'} onclick={() => (kind = 'event')}>{m.cal_editor_kind_event()}</button>
				<button type="button" class:on={kind === 'task'} onclick={() => ((kind = 'task'), (scheduled = false))}>{m.cal_editor_kind_task()}</button>
				<button type="button" class:on={kind === 'hold'} onclick={() => ((kind = 'hold'), (privacy = privacy === 'shared' ? 'busy' : privacy))}>{m.cal_editor_kind_hold()}</button>
			</div>
		{/if}

		<label class="cal-field">
			<span>{kind === 'hold' ? m.cal_editor_hold_label() : m.cal_editor_title()}</span>
			<input type="text" bind:value={title} maxlength="200" placeholder={kind === 'hold' ? m.cal_editor_placeholder_hold() : kind === 'task' ? m.cal_editor_placeholder_task() : m.cal_editor_placeholder_event()} />
		</label>

		<label class="cal-field">
			<span>{m.cal_editor_calendar()}</span>
			<select bind:value={calendarId} disabled={isEdit && !!source?.attendees?.length}>
				{#each writable as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</label>

		{#if kind === 'task'}
			<div class="cal-field two">
				<label>
					<span>{m.cal_editor_due_date()}</span>
					<input type="date" bind:value={dueDate} />
				</label>
				<label>
					<span>{m.cal_editor_time()}</span>
					<input type="time" bind:value={dueTime} />
				</label>
			</div>
			<div class="cal-field two">
				<label>
					<span>{m.cal_editor_estimate()}</span>
					<input type="number" min="0" step="5" bind:value={estimate} placeholder="30" />
				</label>
				<label>
					<span>{m.cal_editor_owner()}</span>
					<select bind:value={ownerEmail}>
						<option value="">{m.cal_editor_unassigned()}</option>
						{#each members as member (member.accountId)}
							<option value={member.email}>{member.fullName || member.email}</option>
						{/each}
					</select>
				</label>
			</div>
			<label class="cal-check">
				<input type="checkbox" bind:checked={scheduled} />
				{m.cal_editor_timebox()}
			</label>
		{/if}

		{#if kind !== 'task' || scheduled}
			<div class="cal-field two">
				<label>
					<span>{m.cal_editor_starts()}</span>
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
					<span>{m.cal_editor_ends()}</span>
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
				<label class="cal-check"><input type="checkbox" bind:checked={allDay} />{m.cal_editor_all_day()}</label>
				{#if !allDay}
					<label class="cal-check"><input type="checkbox" bind:checked={floating} />{m.cal_editor_floating()}</label>
					{#if !floating}
						<select class="tz" bind:value={timeZone} aria-label={m.cal_editor_time_zone_aria()}>
							{#each zones as z (z)}
								<option value={z}>{z}</option>
							{/each}
						</select>
					{/if}
				{/if}
			</div>
			{#if kind !== 'task' && !thisOnly}
				<div class="cal-field">
					<span>{m.cal_editor_repeats({ summary: rruleSummary(rrule) })}</span>
					<RecurrenceEditor value={rrule} {startDate} onChange={(v) => (rrule = v)} />
				</div>
			{/if}
		{/if}

		{#if kind === 'event'}
			<div class="cal-field">
				<span>{m.cal_editor_guests()}</span>
				<GuestField value={attendees} exclude={myAddressList()} onChange={(next) => (attendees = next)} />
			</div>
			<div class="cal-field two">
				<label>
					<span>{m.cal_editor_location()}</span>
					<input type="text" bind:value={location} maxlength="240" placeholder={m.cal_editor_location_placeholder()} />
				</label>
				<label>
					<span>{m.cal_editor_video()}</span>
					<input type="url" bind:value={videoUrl} maxlength="500" placeholder="https://" />
				</label>
			</div>
		{/if}

		{#if kind !== 'hold'}
			<label class="cal-field">
				<span>{m.cal_editor_notes()}</span>
				<textarea rows="3" bind:value={notes} maxlength="8000"></textarea>
			</label>
		{/if}

		<div class="cal-field">
			<span>{m.cal_editor_reminders()}</span>
			<div class="reminders">
				{#each reminders as minutes (minutes)}
					<span class="guest-chip">
						{reminderLabel(minutes)}
						<button type="button" aria-label={m.cal_editor_remove_reminder_aria()} onclick={() => (reminders = reminders.filter((x) => x !== minutes))}>×</button>
					</span>
				{/each}
				<select bind:value={reminderPick} onchange={addReminder} aria-label={m.cal_editor_add_reminder_aria()}>
					<option value="">{m.cal_editor_add_reminder()}</option>
					{#each REMINDER_PRESETS as value (value)}
						<option value={String(value)}>{reminderLabel(value)}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="cal-field">
			<span>{m.cal_editor_visibility()}</span>
			<div class="seg">
				<button type="button" class:on={privacy === 'private'} onclick={() => (privacy = 'private')}>{m.cal_privacy_private()}</button>
				<button type="button" class:on={privacy === 'busy'} onclick={() => (privacy = 'busy')}>{m.cal_privacy_busy()}</button>
				{#if kind !== 'hold'}
					<button type="button" class:on={privacy === 'shared'} onclick={() => (privacy = 'shared')}>{m.cal_privacy_shared()}</button>
				{/if}
			</div>
		</div>

		<DisclosureBoundary heading={m.cal_boundary_heading_device()} headingIcon={ShieldCheck} lines={boundary} />

		{#if error}<div class="cal-error" role="alert">{error}</div>{/if}
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<span class="note">{calendarStore.online ? m.cal_editor_note_online() : m.cal_editor_note_offline()}</span>
		<div class="grow"></div>
		<Button variant="ghost" disabled={busy} onclick={() => cal.closeEditor()}>{m.common_cancel()}</Button>
		<Button variant="primary" disabled={busy} onclick={save}>{isEdit ? m.common_save() : m.common_add()}</Button>
	</Dialog.Footer>
</Dialog.Content>
