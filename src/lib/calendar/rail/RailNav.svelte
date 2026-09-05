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
		<Users size={16} />Family &amp; team agenda{#if cal.agendaBadge}<span class="rn-c">{cal.agendaBadge}</span>{/if}
	</button>
	<button
		type="button"
		class="rn-item"
		class:on={cal.view === 'avail'}
		onclick={() => cal.goTo('avail')}
	>
		<ShieldCheck size={16} />Availability
	</button>
	{#if import.meta.env.DEV}
		<button
			type="button"
			class="rn-item"
			class:on={cal.view === 'booking'}
			onclick={() => cal.goTo('booking')}
		>
			<Globe size={16} />Booking pages
		</button>
	{/if}
</div>
