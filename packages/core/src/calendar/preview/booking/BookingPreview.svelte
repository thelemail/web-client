<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import Video from '@lucide/svelte/icons/video';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import { BOOKING_DAYS } from '../fixtures';
	import { cal } from '../state.svelte';

	const day = $derived(BOOKING_DAYS[cal.bookingDay]);
</script>

<div class="chrome">
	<div class="chrome-bar">
		<span class="dots"><i></i><i></i><i></i></span>
		<span class="url"><Lock size={12} />thelema.co/book/consultation</span>
	</div>
	<div class="bkpage">
		<div class="bk-head">
			<Avatar initials="TC" size={46} bg="var(--pine-100)" fg="var(--pine-700)" />
			<div>
				<div class="bk-t">{m.cal_bkprev_title()}</div>
				<div class="bk-s">{m.cal_bkprev_desc()}</div>
				<div class="bk-meta">
					<span class="bk-tag"><Clock size={12} />{m.cal_bkprev_duration()}</span>
					<span class="bk-tag"><Video size={12} />{m.cal_bkprev_link_note()}</span>
					<span class="bk-tag"><AtSign size={12} />bookings@thelema.co</span>
				</div>
			</div>
		</div>
		<div class="bk-body">
			<div>
				<div class="bk-days">
					{#each BOOKING_DAYS as entry, i (entry.num)}
						<button
							type="button"
							class="bk-day"
							class:on={cal.bookingDay === i}
							class:full={!entry.free}
							onclick={() => cal.pickBookingDay(i)}
						>
							<span class="bd1">{entry.dow}</span>
							<span class="bd2">{entry.num}</span>
							<span class="bd3">{entry.free ? m.cal_bkprev_open({ count: entry.free }) : m.cal_bkprev_full()}</span>
						</button>
					{/each}
				</div>
				<div class="bk-slots">
					{#each day.slots as slot, i (slot)}
						<button
							type="button"
							class="bk-slot"
							class:on={cal.bookingSlot === i}
							onclick={() => (cal.bookingSlot = i)}
						>
							{slot}
						</button>
					{/each}
				</div>
				<div class="bk-note bk-zone">{m.cal_bkprev_zone({ note: day.note })}</div>
			</div>
			<div class="bk-side">
				<div class="bk-seal">
					<span class="wax"></span>
					<div>
						<div class="bs-t">{m.cal_bkprev_hosted()}</div>
						<div class="bs-s">{m.cal_bkprev_hosted_desc()}</div>
					</div>
				</div>
				<div class="bk-note">
					<b>{m.cal_bkprev_notice_title()}</b><br />{m.cal_bkprev_notice_body()}
				</div>
				<div class="bk-note">
					<b>{m.cal_bkprev_fallback_title()}</b><br />{m.cal_bkprev_fallback_body()}
				</div>
				<Button variant="primary" block onclick={() => cal.confirmBooking()}>{cal.bookingCta}</Button>
			</div>
		</div>
	</div>
</div>
