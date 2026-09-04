<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Repeat from '@lucide/svelte/icons/repeat';
	import User from '@lucide/svelte/icons/user';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { cal } from '../state.svelte';
	import type { TaskFixture } from '../types';

	interface Props {
		task: TaskFixture & { color: string; done: boolean };
	}

	let { task }: Props = $props();
</script>

<div class="tkrow" class:boxed={task.boxed} class:done={task.done} style:--c={task.color}>
	<span class="tkr-bar"></span>
	<Checkbox
		id="task-{task.id}"
		checked={task.done}
		onCheckedChange={() => cal.toggleTask(task.id)}
		class="mt-0.5 size-[18px] rounded-[5px]"
	/>
	<div class="tkr-main">
		<Label for="task-{task.id}" class="tkr-t">{task.title}</Label>
		<div class="tkr-meta">
			<span class="mchip" class:late={task.late}><Clock size={12} />{task.due}</span>
			<span class="mchip"><Hourglass size={12} />{task.est}</span>
			<span class="mchip"><User size={12} />{task.owner}</span>
			{#if task.roll}
				<span class="mchip roll"><Repeat size={12} />{task.roll}</span>
			{/if}
		</div>
	</div>
</div>
