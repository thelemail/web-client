<script lang="ts">
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { ScrollArea } from '$core/components/ui/scroll-area';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';
	import CapacityBar from './CapacityBar.svelte';
	import TaskRow from './TaskRow.svelte';
</script>

<div class="tkpane">
	<div class="tkpane-h">
		<ListTodo size={17} color="var(--brass-600)" />
		<span class="tt">{m.cal_tasks_title()}</span>
		<span class="cnt">{cal.taskCount}</span>
		<button
			type="button"
			class="icon-btn"
			aria-label={m.cal_tasks_new_aria()}
			onclick={() => cal.openEditor({ mode: 'create', kind: 'task' })}
		>
			<Plus size={16} />
		</button>
		<button
			type="button"
			class="icon-btn tk-x"
			aria-label={m.cal_tasks_close_aria()}
			onclick={() => (cal.tasksOpen = false)}
		>
			<X size={16} />
		</button>
	</div>
	<ScrollArea class="min-h-0 flex-1">
		<div class="tkpane-scroll">
			<CapacityBar />
			{#if !cal.taskGroups.length}
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
