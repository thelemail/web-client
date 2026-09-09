<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Mail from '@lucide/svelte/icons/mail';
	import Repeat from '@lucide/svelte/icons/repeat';
	import User from '@lucide/svelte/icons/user';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { cal, type TaskRowView } from '../state.svelte';

	interface Props {
		task: TaskRowView;
	}

	let { task }: Props = $props();
</script>

<div class="tkrow" class:boxed={task.boxed} class:done={task.done} style:--c={task.color}>
	<span class="tkr-bar"></span>
	<Checkbox
		id="task-{task.id}"
		checked={task.done}
		aria-label="Complete {task.title}"
		onCheckedChange={() => cal.toggleTask(task.entry)}
		class="mt-0.5 size-[18px] rounded-[5px]"
	/>
	<div class="tkr-main">
		<button
			type="button"
			class="tkr-t"
			onclick={() => cal.openEditor({ mode: 'edit', item: task.entry.item })}
		>
			{task.title}
		</button>
		<div class="tkr-meta">
			<span class="mchip" class:late={task.late}><Clock size={12} />{task.due}</span>
			{#if task.est}
				<span class="mchip"><Hourglass size={12} />{task.est}</span>
			{/if}
			<span class="mchip"><User size={12} />{task.owner}</span>
			{#if task.roll}
				<span class="mchip roll"><Repeat size={12} />{task.roll}</span>
			{/if}
			{#if task.fromMail}
				<span class="mchip"><Mail size={12} />from mail</span>
			{/if}
		</div>
	</div>
</div>
