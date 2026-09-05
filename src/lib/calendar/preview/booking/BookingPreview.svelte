<script lang="ts">
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import Video from '@lucide/svelte/icons/video';
	import Avatar from '$lib/components/Avatar.svelte';
	import { Button } from '$lib/components/ui/button';
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
				<div class="bk-t">Consultation with Thélème Co</div>
				<div class="bk-s">
					Thirty minutes to talk through a migration, a domain, or whether we are the wrong choice
					for you.
				</div>
				<div class="bk-meta">
					<span class="bk-tag"><Clock size={12} />30 min</span>
					<span class="bk-tag"><Video size={12} />Link sent on confirmation</span>
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
							<span class="bd3">{entry.free ? `${entry.free} open` : 'full'}</span>
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
				<div class="bk-note bk-zone">All times in Europe/Paris (CEST). {day.note}</div>
			</div>
			<div class="bk-side">
				<div class="bk-seal">
					<span class="wax"></span>
					<div>
						<div class="bs-t">Hosted by Thelemail</div>
						<div class="bs-s">
							No account needed to book. Your name and address are used for the invitation and
							nothing else.
						</div>
					</div>
				</div>
				<div class="bk-note">
					<b>Minimum notice</b><br />Twelve hours, so nothing lands on a morning that is already
					gone.
				</div>
				<div class="bk-note">
					<b>If none of these work</b><br />Reply to the thread and ask for other times. Someone will
					offer three.
				</div>
				<Button variant="primary" block onclick={() => cal.confirmBooking()}>{cal.bookingCta}</Button>
			</div>
		</div>
	</div>
</div>
