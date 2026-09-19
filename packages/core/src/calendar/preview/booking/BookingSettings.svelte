<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Avatar from '$core/components/Avatar.svelte';
	import { Switch } from '$core/components/ui/switch';
	import { m } from '$paraglide/messages.js';
	import DisclosureBoundary from '../../DisclosureBoundary.svelte';
	import { cal } from '../state.svelte';
	import type { BoundaryLine } from '../../types';

	const FACTS = [
		{ key: 'address', title: () => m.cal_bkset_public_address(), body: () => 'thelema.co/book/consultation', mono: true },
		{
			key: 'source',
			title: () => m.cal_bkset_drawn_from(),
			body: () => m.cal_bkset_drawn_from_body(),
			mono: false
		}
	];

	const LIMITS = [
		{ key: 'notice', title: () => m.cal_bkset_min_notice(), value: () => m.cal_bkset_min_notice_value() },
		{ key: 'buffer', title: () => m.cal_bkset_buffer(), value: () => m.cal_bkset_buffer_value() },
		{ key: 'cap', title: () => m.cal_bkset_cap(), value: () => m.cal_bkset_cap_value() }
	];

	const visibility: BoundaryLine[] = $derived([
		{ tone: 'yes', text: m.cal_bkset_vis_open() },
		{
			tone: 'no',
			icon: EyeOff,
			text: m.cal_bkset_vis_hidden()
		},
		{
			tone: 'yes',
			icon: KeyRound,
			text: m.cal_bkset_vis_computed()
		}
	]);
</script>

<div>
	<div class="card">
		<div class="card-h">
			<div>
				<div class="ch-t">{m.cal_bkset_title()}</div>
				<div class="ch-s">bookings@thelema.co</div>
			</div>
		</div>
		<div class="card-b tight">
			{#each FACTS as fact (fact.key)}
				<div class="srow">
					<div class="sr-m">
						<div class="sr-t">{fact.title()}</div>
						<div class="sr-s" class:mono={fact.mono}>{fact.body()}</div>
					</div>
				</div>
			{/each}
			{#each LIMITS as limit (limit.key)}
				<div class="srow">
					<div class="sr-m"><div class="sr-t">{limit.title()}</div></div>
					<span class="sr-v">{limit.value()}</span>
				</div>
			{/each}
			<div class="srow">
				<div class="sr-m">
					<div class="sr-t">{m.cal_bkset_request()}</div>
					<div class="sr-s">{m.cal_bkset_request_desc()}</div>
				</div>
				<Switch
					checked={cal.bookingRequest}
					onCheckedChange={() => cal.toggleBookingRequest()}
					aria-label={m.cal_bkset_request()}
				/>
			</div>
			<div class="srow">
				<div class="sr-m">
					<div class="sr-t">{m.cal_bkset_assign()}</div>
					<div class="sr-s">{m.cal_bkset_assign_desc()}</div>
				</div>
				<span class="ownchip">
					<Avatar initials="FR" size={20} bg="#234132" fg="#EEF2EA" />François
				</span>
			</div>
		</div>
	</div>
	<DisclosureBoundary heading={m.cal_bkset_visitor_heading()} headingIcon={Eye} lines={visibility} />
</div>
