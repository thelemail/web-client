<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Clock from '@lucide/svelte/icons/clock';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { formatWhenLong } from './data';
	import {
		parseLocalInput,
		scheduleBounds,
		schedulePresets,
		toLocalInput,
		validateWhen,
		type TimeRangeError
	} from './timePresets';

	interface Props {
		busy?: boolean;
		onSchedule: (when: Date) => void;
		onClose: () => void;
	}

	let { busy = false, onSchedule, onClose }: Props = $props();

	const now = new Date();
	const bounds = scheduleBounds(now);
	const presets = schedulePresets(now);

	const CUSTOM = 'custom';
	let selected = $state(presets[0]?.id ?? CUSTOM);
	let customValue = $state(toLocalInput(presets[0]?.when ?? bounds.min));

	const customWhen = $derived(parseLocalInput(customValue));
	const when = $derived(
		selected === CUSTOM ? customWhen : (presets.find((p) => p.id === selected)?.when ?? null)
	);
	const rangeError = $derived(validateWhen(when, bounds));

	const RANGE_MESSAGES: Record<TimeRangeError, () => string> = {
		invalid: () => m.mail_time_invalid(),
		past: () => m.mail_time_past(),
		too_soon: () => m.mail_schedule_too_soon(),
		too_far: () => m.mail_schedule_too_far()
	};

	function confirm() {
		if (!when || rangeError) return;
		onSchedule(when);
	}
</script>

{#snippet body()}
	<p class="cfd-p">{m.mail_schedule_body()}</p>
	<div class="sch-list">
		{#each presets as p (p.id)}
			<button
				type="button"
				class="sch-opt"
				class:on={selected === p.id}
				aria-pressed={selected === p.id}
				disabled={busy}
				onclick={() => (selected = p.id)}
			>
				<Clock size={16} />
				<span class="sch-name">{p.label}</span>
				<span class="sch-when">{formatWhenLong(p.when, now)}</span>
			</button>
		{/each}
		<button
			type="button"
			class="sch-opt"
			class:on={selected === CUSTOM}
			aria-pressed={selected === CUSTOM}
			disabled={busy}
			onclick={() => (selected = CUSTOM)}
		>
			<Clock size={16} />
			<span class="sch-name">{m.mail_pick_date_time()}</span>
		</button>
	</div>
	{#if selected === CUSTOM}
		<input
			class="sch-input"
			type="datetime-local"
			bind:value={customValue}
			min={toLocalInput(bounds.min)}
			max={toLocalInput(bounds.max)}
			disabled={busy}
			aria-label={m.mail_schedule_input_aria()}
		/>
	{/if}
	{#if rangeError}
		<p class="cfd-hint">{RANGE_MESSAGES[rangeError]()}</p>
	{:else if when}
		<p class="cfd-hint">{m.mail_schedule_goes_out({ when: formatWhenLong(when, now).toLowerCase() })}</p>
	{/if}
{/snippet}

<ConfirmDialog
	icon={Clock}
	title={m.mail_schedule_title()}
	confirmLabel={m.mail_schedule_confirm()}
	{busy}
	disabled={!when || !!rangeError}
	{body}
	onConfirm={confirm}
	{onClose}
/>
