<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faClock,
		faEnvelope,
		faHourglass,
		faRepeat,
		faUser
	} from '@fortawesome/pro-regular-svg-icons';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { m } from '$paraglide/messages.js';
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
		aria-label={m.cal_task_complete_aria({ title: task.title })}
		onCheckedChange={() => cal.toggleTask(task.entry)}
		class="mt-0.5 size-[18px]"
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
			<span class="mchip" class:late={task.late}><Icon icon={faClock} size={12} />{task.due}</span>
			{#if task.est}
				<span class="mchip"><Icon icon={faHourglass} size={12} />{task.est}</span>
			{/if}
			<span class="mchip"><Icon icon={faUser} size={12} />{task.owner}</span>
			{#if task.roll}
				<span class="mchip roll"><Icon icon={faRepeat} size={12} />{task.roll}</span>
			{/if}
			{#if task.fromMail}
				<span class="mchip"><Icon icon={faEnvelope} size={12} />{m.cal_task_from_mail()}</span>
			{/if}
		</div>
	</div>
</div>
