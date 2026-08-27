<script lang="ts">
	import Calendar from '@lucide/svelte/icons/calendar';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Video from '@lucide/svelte/icons/video';
	import Check from '@lucide/svelte/icons/check';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import X from '@lucide/svelte/icons/x';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import { sendRsvp } from './calendar/rsvp';
	import type { CalendarEvent, IcalDateTime } from './render/icalParse';
	import { formatEventWhen, type Message, type RsvpStatus } from './data';

	interface Props {
		ev: CalendarEvent;
		message: Message;
	}

	let { ev, message }: Props = $props();

	let rsvp = $state<RsvpStatus | null>(null);
	$effect(() => {
		void message.id;
		rsvp = message.rsvpStatus ?? null;
	});

	let sending = $state(false);
	let err = $state<string | null>(null);

	const ACK: Record<RsvpStatus, string> = {
		accepted: 'You’re going.',
		tentative: 'You replied maybe.',
		declined: 'You declined.'
	};

	const monthDay = $derived.by(() => {
		if (ev.start?.iso) {
			const d = new Date(ev.start.iso);
			if (!isNaN(d.getTime())) {
				return {
					m: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
					d: String(d.getDate())
				};
			}
		}
		return { m: 'EVT', d: '·' };
	});

	const dateLabel = $derived.by(() => formatDateRange(ev));
	const isVideo = $derived(/^https?:\/\//i.test(ev.location ?? '') || /meet\.|zoom\.|teams\.|webex\./i.test(ev.location ?? ''));

	function pointLabel(p: IcalDateTime | undefined): string {
		if (!p) return '';
		if (p.allDay || !p.iso.endsWith('Z')) return p.display;
		const d = new Date(p.iso);
		return isNaN(d.getTime()) ? p.display : formatEventWhen(d);
	}

	function formatDateRange(e: CalendarEvent): string {
		const start = pointLabel(e.start);
		const end = pointLabel(e.end);
		if (!start) return '';
		if (!end || start === end) return start;
		return `${start} → ${end}`;
	}

	const shownAttendees = $derived((ev.attendees ?? []).slice(0, 4));
	const extra = $derived(Math.max(0, (ev.attendees?.length ?? 0) - shownAttendees.length));

	function nameOf(email: string): { initials: string; name: string } {
		const fullName = ev.attendeeNames?.[email] ?? email;
		const handle = fullName.includes('@') ? fullName.split('@')[0] : fullName;
		const parts = handle.replace(/[._-]+/g, ' ').split(' ').filter(Boolean);
		const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
		return { initials: initials || handle[0]?.toUpperCase() || '?', name: fullName };
	}

	async function choose(next: RsvpStatus) {
		if (!ev.uid) {
			err = 'Cannot RSVP — event has no UID.';
			return;
		}
		const prev = rsvp;
		rsvp = next;
		sending = true;
		err = null;
		try {
			await sendRsvp({ message, event: ev, status: next });
		} catch (e) {
			rsvp = prev;
			err = e instanceof Error ? e.message : 'Failed to send RSVP.';
		} finally {
			sending = false;
		}
	}

	function change() {
		rsvp = null;
	}

	function normalizeHref(s: string): string {
		if (/^https?:\/\//i.test(s)) return s;
		return `https://${s}`;
	}
</script>

<div class="evt" class:r-yes={rsvp === 'accepted'} class:r-maybe={rsvp === 'tentative'} class:r-no={rsvp === 'declined'}>
	<div class="evt-top">
		<div class="evt-cal">
			<span class="m">{monthDay.m}</span>
			<span class="d">{monthDay.d}</span>
		</div>
		<div class="evt-info">
			<div class="evt-kicker"><Calendar size={13} />Calendar invitation</div>
			<div class="evt-title">{ev.summary || 'Event invite'}</div>
			<div class="evt-meta">
				{#if dateLabel}
					<span><Clock size={14} />{dateLabel}</span>
				{/if}
				{#if ev.location}
					<span>
						{#if isVideo}
							<Video size={14} />
							<a class="evt-link mono" href={normalizeHref(ev.location)} target="_blank" rel="noreferrer">{ev.location}</a>
						{:else}
							<MapPin size={14} />
							<span class="mono">{ev.location}</span>
						{/if}
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if (ev.attendees?.length ?? 0) > 0}
		<div class="evt-attend">
			<div class="evt-faces">
				{#each shownAttendees as a (a)}
					{@const meta = nameOf(a)}
					<span class="av" title={meta.name}>{meta.initials}</span>
				{/each}
				{#if extra > 0}
					<span class="evt-more">+{extra}</span>
				{/if}
			</div>
			<span class="evt-who">
				{ev.attendees.length} guest{ev.attendees.length === 1 ? '' : 's'}{#if ev.organizer} · organised by {ev.organizerName ?? ev.organizer}{/if}
			</span>
		</div>
	{/if}

	<div class="evt-rsvp">
		{#if rsvp}
			<span class="evt-ack">
				<CheckCircle size={15} />
				{ACK[rsvp]}
				<button type="button" class="evt-change" onclick={change} disabled={sending}>Change</button>
			</span>
		{:else}
			<span class="evt-q">Going?</span>
			<div class="evt-seg">
				<button type="button" class="evt-opt yes" disabled={sending} onclick={() => choose('accepted')}>
					<Check size={15} />Yes
				</button>
				<button type="button" class="evt-opt maybe" disabled={sending} onclick={() => choose('tentative')}>
					<HelpCircle size={15} />Maybe
				</button>
				<button type="button" class="evt-opt no" disabled={sending} onclick={() => choose('declined')}>
					<X size={15} />No
				</button>
			</div>
		{/if}
	</div>

	{#if err}
		<div class="evt-err" role="alert">{err}</div>
	{/if}
</div>

<style>
	.evt {
		margin-top: 22px;
		border: 1px solid var(--border-strong, #cfc4ad);
		border-radius: 12px;
		background: var(--surface, #faf7eb);
		overflow: hidden;
	}
	.evt-top {
		display: flex;
		align-items: flex-start;
		gap: 15px;
		padding: 17px 18px 15px;
	}
	.evt-cal {
		width: 54px;
		flex: 0 0 auto;
		border: 1px solid var(--border-strong, #cfc4ad);
		border-radius: 8px;
		overflow: hidden;
		text-align: center;
		background: var(--surface, #faf7eb);
	}
	.evt-cal .m {
		display: block;
		background: var(--pine-700, #234132);
		color: var(--fg-on-pine, #eef2ea);
		font: 600 10px/1 var(--font-sans, system-ui, sans-serif);
		letter-spacing: 0.07em;
		padding: 6px 0;
		text-transform: uppercase;
	}
	.evt-cal .d {
		display: block;
		font-family: var(--font-sans);
		font-size: 25px;
		font-weight: 500;
		color: var(--fg-strong, #1f221b);
		padding: 7px 0 9px;
		line-height: 1;
	}
	.evt-info {
		min-width: 0;
		flex: 1 1 auto;
	}
	.evt-kicker {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--ink-500, #6b7360);
	}
	.evt-kicker :global(svg) {
		width: 13px;
		height: 13px;
	}
	.evt-title {
		margin-top: 4px;
		font-family: var(--font-sans);
		font-size: 19px;
		font-weight: 500;
		color: var(--fg-strong, #1f221b);
		line-height: 1.25;
		letter-spacing: -0.01em;
	}
	.evt-meta {
		margin-top: 9px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.evt-meta span {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--ink-600, #4a4d3f);
		min-width: 0;
	}
	.evt-meta :global(svg) {
		width: 14px;
		height: 14px;
		color: var(--ink-400, #8e8e7d);
		flex: 0 0 auto;
	}
	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 12px;
	}
	.evt-link {
		color: var(--link, #2b5aa3);
		text-decoration: none;
	}
	.evt-link:hover {
		text-decoration: underline;
	}

	.evt-attend {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 18px;
		border-top: 1px solid var(--border, #e6dfcd);
		background: var(--paper-50, #f6f1e3);
	}
	.evt-faces {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}
	.evt-faces .av {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--paper-200, #e0d6bf);
		color: var(--ink-700, #43473a);
		font-size: 11.5px;
		font-weight: 600;
		box-shadow: 0 0 0 2px var(--paper-50, #f6f1e3);
		margin-left: -7px;
	}
	.evt-faces .av:first-child {
		margin-left: 0;
	}
	.evt-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--paper-200, #e0d6bf);
		color: var(--ink-700, #43473a);
		font-size: 11px;
		font-weight: 600;
		box-shadow: 0 0 0 2px var(--paper-50, #f6f1e3);
		margin-left: -7px;
	}
	.evt-who {
		font-size: 12px;
		color: var(--fg-muted, #5a5d4e);
	}

	.evt-rsvp {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 13px 18px;
		border-top: 1px solid var(--border, #e6dfcd);
	}
	.evt-q {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-strong, #1f221b);
	}
	.evt-seg {
		display: inline-flex;
		border: 1px solid var(--border-strong, #cfc4ad);
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.evt-opt {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink-700, #43473a);
		padding: 8px 13px;
		background: var(--surface, #faf7eb);
		border: none;
		border-right: 1px solid var(--border, #e6dfcd);
		cursor: pointer;
	}
	.evt-opt:last-child {
		border-right: none;
	}
	.evt-opt :global(svg) {
		width: 15px;
		height: 15px;
		color: var(--ink-400, #8e8e7d);
	}
	.evt-opt:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.evt-opt.yes:hover:not(:disabled) {
		background: var(--pine-50, #ebf1ec);
		color: var(--pine-700, #234132);
	}
	.evt-opt.yes:hover:not(:disabled) :global(svg) {
		color: var(--pine-600, #2e5440);
	}
	.evt-opt.maybe:hover:not(:disabled) {
		background: var(--brass-100, #f2e6cd);
		color: var(--brass-700, #7e5b27);
	}
	.evt-opt.maybe:hover:not(:disabled) :global(svg) {
		color: var(--brass-600, #a87c3d);
	}
	.evt-opt.no:hover:not(:disabled) {
		background: var(--danger-100, #f5d6d2);
		color: var(--danger-700, #872820);
	}
	.evt-opt.no:hover:not(:disabled) :global(svg) {
		color: var(--danger-500, #b5453a);
	}
	.evt-ack {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--fg-strong, #1f221b);
	}
	.evt-ack :global(svg) {
		width: 15px;
		height: 15px;
		flex: 0 0 auto;
	}
	.evt-change {
		margin-left: 4px;
		border: none;
		background: none;
		color: var(--link, #2b5aa3);
		font-size: 12.5px;
		font-weight: 600;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.evt-change:hover {
		background: var(--paper-100, #efe8d5);
	}

	.r-yes {
		border-color: var(--success-500, #3f8c57);
	}
	.r-yes .evt-cal .m {
		background: var(--success-700, #1f5a36);
	}
	.r-yes .evt-ack :global(svg) {
		color: var(--success-700, #1f5a36);
	}
	.r-maybe .evt-ack :global(svg) {
		color: var(--brass-600, #a87c3d);
	}
	.r-no .evt-ack :global(svg) {
		color: var(--danger-500, #b5453a);
	}

	.evt-err {
		padding: 8px 18px 13px;
		font-size: 12px;
		color: var(--danger-700, #872820);
	}

	:global([data-theme='dark']) .evt-cal .m {
		background: #234132;
	}
	:global([data-theme='dark']) .r-yes .evt-cal .m {
		background: #2c6b3f;
	}

	@media (max-width: 640px) {
		.evt-top {
			padding: 14px 14px 12px;
		}
		.evt-attend,
		.evt-rsvp {
			padding-left: 14px;
			padding-right: 14px;
			flex-wrap: wrap;
		}
	}
</style>
