<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import { paletteFor } from '$core/mail/avatarPalette';
	import { initialsFor } from '$core/mail/initials';
	import { dateToInstant } from '../tz';
	import { cal } from '../state.svelte';
	import { availability } from './availability.svelte';
	import type { BoardDay, BoardLane } from './board';

	const TRUST_COPY: Record<string, string> = {
		signature_failed: 'Signature did not match. Treat these blocks as unconfirmed.',
		key_mismatch: 'Signed with a key we do not have for this person.',
		key_unresolved: 'We could not fetch this signer’s key, so nothing here is confirmed.',
		signer_unknown: 'Published by an account we cannot identify.',
		unsigned: 'These blocks arrived without a signature.'
	};

	const days = $derived.by<BoardDay[]>(() => {
		const range = cal.weekWindow;
		const today = cal.today;
		return range.dates.map((date, i) => {
			const start = dateToInstant(date, cal.timeZone).getTime();
			const next = range.dates[i + 1]
				? dateToInstant(range.dates[i + 1], cal.timeZone).getTime()
				: range.to.getTime();
			return {
				date,
				startMs: start,
				endMs: next,
				weekend: [0, 6].includes(new Date(start).getDay()),
				today: date === today
			};
		});
	});

	const board = $derived(availability.board(days));
	const unverified = $derived(board.counts.unverified);

	function laneLabel(lane: BoardLane): string {
		return lane.isMe ? `${lane.name} (you)` : lane.name;
	}

	function blockLabel(lane: BoardLane, verified: boolean): string {
		return `${laneLabel(lane)} is busy${verified ? '' : ', unconfirmed'}`;
	}

	$effect(() => {
		const range = cal.weekWindow;
		void availability.load(range.from, range.to);
	});
</script>

<div class="avail">
	<div class="avail-head">
		<div class="avail-who"></div>
		{#each board.days as day (day.date)}
			<div class="avail-dh" class:is-today={day.today} class:is-weekend={day.weekend}>
				{new Date(day.startMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
			</div>
		{/each}
	</div>

	{#if availability.error}
		<div class="avail-note">
			<span>{availability.error}</span>
			<Button
				variant="secondary"
				size="sm"
				onclick={() => availability.load(cal.weekWindow.from, cal.weekWindow.to, true)}
			>
				Try again
			</Button>
		</div>
	{/if}

	{#each board.lanes as lane (lane.key)}
		<div class="avail-lane">
			<div class="avail-who">
				{#if lane.email}
					{@const palette = paletteFor(lane.email)}
					<Avatar
						initials={initialsFor(lane.name, lane.email)}
						size={24}
						bg={palette.bg}
						fg={palette.fg}
					/>
				{/if}
				<span class="avail-nm">
					<span class="an-t">{laneLabel(lane)}</span>
					{#if lane.email}<span class="an-s">{lane.email}</span>{/if}
				</span>
			</div>
			{#each board.days as day, i (day.date)}
				<div class="avail-day" class:is-weekend={day.weekend}>
					{#each lane.segments.filter((s) => s.dayIndex === i) as seg (seg.startMs)}
						<span
							class="avail-blk"
							class:unverified={!seg.verified}
							style:left="{seg.left}%"
							style:width="{Math.max(seg.width, 1.5)}%"
							role="img"
							aria-label={blockLabel(lane, seg.verified)}
						></span>
					{/each}
				</div>
			{/each}
		</div>
		{#if lane.worst && lane.worst !== 'verified'}
			<div class="avail-trust"><TriangleAlert size={13} />{TRUST_COPY[lane.worst]}</div>
		{/if}
	{/each}

	{#if !board.lanes.length && !availability.loading}
		<div class="avail-note">Nothing is published for this week.</div>
	{/if}

	<div class="avail-tally">
		{#if unverified > 0}
			<TriangleAlert size={14} />
			{board.counts.verified} of {board.counts.total} blocks are signed by the account that published
			them and check out.
		{:else if board.counts.total > 0}
			<ShieldCheck size={14} />
			Every block here is signed by the account that published it.
		{/if}
	</div>
</div>
