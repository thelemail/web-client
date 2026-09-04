<script lang="ts">
	import { cal } from '../state.svelte';

	const HEADINGS = [
		{ label: 'Mon', weekend: false },
		{ label: 'Tue', weekend: false },
		{ label: 'Wed', weekend: false },
		{ label: 'Thu', weekend: false },
		{ label: 'Fri', weekend: false },
		{ label: 'Sat', weekend: true },
		{ label: 'Sun', weekend: true }
	];
</script>

<div class="mv">
	<div class="mv-dow">
		{#each HEADINGS as heading (heading.label)}
			<div class:we={heading.weekend}>{heading.label}</div>
		{/each}
	</div>
	<div class="mv-grid">
		{#each cal.monthCells as cell, i (i)}
			<button
				type="button"
				class="mv-cell"
				class:out={cell.outside}
				class:we={cell.weekend}
				class:is-today={cell.today}
				onclick={() => cal.goTo('week')}
			>
				<span class="mv-dh"><span class="mv-dnum">{cell.n}</span></span>
				{#each cell.entries as entry, k (k)}
					<span class="mv-mev" class:allday={entry.allDay} style:--c={entry.color}>
						<span class="mev-dot"></span>
						{#if entry.time}<span class="mev-tm">{entry.time}</span>{/if}
						<span class="mev-t">{entry.title}</span>
					</span>
				{/each}
				{#if cell.more}
					<span class="mv-more">{cell.more}</span>
				{/if}
			</button>
		{/each}
	</div>
</div>
