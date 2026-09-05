<script lang="ts">
	import BookingPreview from './BookingPreview.svelte';
	import BookingSettings from './BookingSettings.svelte';
</script>

<div class="page">
	<div class="page-inner wide">
		<div class="page-h">
			<div class="eyebrow">Booking pages</div>
			<h1>A page on your domain, not a vendor’s.</h1>
			<p>
				A booking page belongs to a role address. The invitation it produces is sent as that role,
				and the person booking sees free times — never the events that made the rest unavailable.
			</p>
		</div>
		<div class="bkwrap">
			<BookingSettings />
			<BookingPreview />
		</div>
	</div>
</div>
