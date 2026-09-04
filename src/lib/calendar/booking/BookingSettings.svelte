<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Avatar from '$lib/components/Avatar.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import { cal } from '../state.svelte';
	import type { BoundaryLine } from '../types';

	const FACTS = [
		{ title: 'Public address', body: 'thelema.co/book/consultation', mono: true },
		{
			title: 'Availability drawn from',
			body: 'Thélème Co and My calendar, as busy windows only',
			mono: false
		}
	];

	const LIMITS = [
		{ title: 'Minimum notice', value: '12 hours' },
		{ title: 'Buffer either side', value: '15 min' },
		{ title: 'Cap per week', value: '6 bookings' }
	];

	const VISIBILITY: BoundaryLine[] = [
		{ tone: 'yes', text: 'Which 30-minute windows are open in the next 14 days.' },
		{
			tone: 'no',
			icon: EyeOff,
			text: 'Not what fills the rest — no titles, no guests, not even how many events there are.'
		},
		{
			tone: 'yes',
			icon: KeyRound,
			text: 'Slots are computed from encrypted busy windows. Generating this page never decrypts content.'
		}
	];
</script>

<div>
	<div class="card">
		<div class="card-h">
			<div>
				<div class="ch-t">Consultation · 30 min</div>
				<div class="ch-s">bookings@thelema.co</div>
			</div>
		</div>
		<div class="card-b tight">
			{#each FACTS as fact (fact.title)}
				<div class="srow">
					<div class="sr-m">
						<div class="sr-t">{fact.title}</div>
						<div class="sr-s" class:mono={fact.mono}>{fact.body}</div>
					</div>
				</div>
			{/each}
			{#each LIMITS as limit (limit.title)}
				<div class="srow">
					<div class="sr-m"><div class="sr-t">{limit.title}</div></div>
					<span class="sr-v">{limit.value}</span>
				</div>
			{/each}
			<div class="srow">
				<div class="sr-m">
					<div class="sr-t">Request to book</div>
					<div class="sr-s">The visitor asks; you accept. Creates a Proposal, not an Event.</div>
				</div>
				<Switch
					checked={cal.bookingRequest}
					onCheckedChange={() => cal.toggleBookingRequest()}
					aria-label="Request to book"
				/>
			</div>
			<div class="srow">
				<div class="sr-m">
					<div class="sr-t">Assign to</div>
					<div class="sr-s">
						Round-robin across the two people on bookings@ is on the roadmap, not in this build.
					</div>
				</div>
				<span class="ownchip">
					<Avatar initials="FR" size={20} bg="#234132" fg="#EEF2EA" />François
				</span>
			</div>
		</div>
	</div>
	<DisclosureBoundary heading="What a visitor can learn" headingIcon={Eye} lines={VISIBILITY} />
</div>
