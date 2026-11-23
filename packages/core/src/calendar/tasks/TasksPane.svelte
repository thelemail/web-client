<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faListCheck, faPlus, faXmark } from '@fortawesome/pro-regular-svg-icons';
	import { ScrollArea } from '$core/components/ui/scroll-area';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import LoadState from '$core/components/LoadState.svelte';
	import CapacityBar from './CapacityBar.svelte';
	import TaskRow from './TaskRow.svelte';
</script>

<div class="tkpane">
	<div class="tkpane-h">
		<Icon icon={faListCheck} size={17} color="var(--brass-600)" />
		<span class="tt">{m.cal_tasks_title()}</span>
		<span class="cnt">{cal.taskCount}</span>
		<button
			type="button"
			class="icon-btn"
			aria-label={m.cal_tasks_new_aria()}
			onclick={() => cal.openEditor({ mode: 'create', kind: 'task' })}
		>
			<Icon icon={faPlus} size={16} />
		</button>
		<button
			type="button"
			class="icon-btn tk-x"
			aria-label={m.cal_tasks_close_aria()}
			onclick={() => (cal.tasksOpen = false)}
		>
			<Icon icon={faXmark} size={16} />
		</button>
	</div>
	<ScrollArea class="min-h-0 flex-1">
		<div class="tkpane-scroll">
			<CapacityBar />
			{#if !calendarStore.loaded && calendarStore.loadError}
				<LoadState
					kind="error"
					label={m.cal_store_load_failed()}
					onRetry={() => void calendarStore.ensureLoaded()}
				/>
			{:else if !calendarStore.loaded}
				<LoadState kind="loading" label={m.common_loading()} rows={2} />
			{:else if !cal.taskGroups.length}
				<div class="tkgroup">{m.cal_tasks_empty()}</div>
			{/if}
			{#each cal.taskGroups as group (group.name)}
				<div class="tkgroup">{group.name}</div>
				{#each group.rows as task (task.id)}
					<TaskRow {task} />
				{/each}
			{/each}
		</div>
	</ScrollArea>
</div>
