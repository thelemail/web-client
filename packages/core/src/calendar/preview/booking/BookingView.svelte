<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import BookingPreview from './BookingPreview.svelte';
	import BookingSettings from './BookingSettings.svelte';
</script>

<div class="page">
	<div class="page-inner wide">
		<div class="page-h">
			<div class="eyebrow">{m.cal_booking_eyebrow()}</div>
			<h1>{m.cal_booking_title()}</h1>
			<p>{m.cal_booking_desc()}</p>
		</div>
		<div class="bkwrap">
			<BookingSettings />
			<BookingPreview />
		</div>
	</div>
</div>
