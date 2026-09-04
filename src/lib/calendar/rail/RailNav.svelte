<script lang="ts">
	import Globe from '@lucide/svelte/icons/globe';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Users from '@lucide/svelte/icons/users';
	import { cal } from '../state.svelte';
</script>

<div class="rail-nav">
	<button
		type="button"
		class="rn-item"
		class:on={cal.view === 'agenda'}
		onclick={() => cal.goTo('agenda')}
	>
		<Users size={16} />Family &amp; team agenda<span class="rn-c">2</span>
	</button>
	<button
		type="button"
		class="rn-item"
		class:on={cal.view === 'avail'}
		onclick={() => cal.goTo('avail')}
	>
		<ShieldCheck size={16} />Availability &amp; mirroring
	</button>
	<button
		type="button"
		class="rn-item"
		class:on={cal.view === 'booking'}
		onclick={() => cal.goTo('booking')}
	>
		<Globe size={16} />Booking pages
	</button>
</div>
