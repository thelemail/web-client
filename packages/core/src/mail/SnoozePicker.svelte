<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Clock from '@lucide/svelte/icons/clock';
	import AnchoredMenu from '$core/components/AnchoredMenu.svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import { formatClock, formatWeekday, formatWhenLong } from './data';
	import {
		parseLocalInput,
		snoozeBounds,
		snoozePresets,
		toLocalInput,
		validateWhen,
		type TimeRangeError
	} from './timePresets';

	interface Props {
		anchor: HTMLElement | undefined;
		onPick: (when: Date) => void;
		onClose: () => void;
	}

	let { anchor, onPick, onClose }: Props = $props();

	const now = new Date();
	const bounds = snoozeBounds(now);
	const presets = snoozePresets(now);

	let custom = $state(false);
	let customValue = $state(toLocalInput(presets[presets.length - 1]?.when ?? bounds.min));
	let root: HTMLDivElement | undefined = $state();

	const customWhen = $derived(parseLocalInput(customValue));
	const customError = $derived(validateWhen(customWhen, bounds));

	const RANGE_MESSAGES: Record<TimeRangeError, () => string> = {
		invalid: () => m.mail_time_invalid(),
		past: () => m.mail_time_past(),
		too_soon: () => m.mail_snooze_too_soon(),
		too_far: () => m.mail_snooze_too_far()
	};

	function hint(when: Date): string {
		const clock = formatClock(when);
		const sameDay =
			when.getFullYear() === now.getFullYear() &&
			when.getMonth() === now.getMonth() &&
			when.getDate() === now.getDate();
		return sameDay ? clock : `${formatWeekday(when)} ${clock}`;
	}

	function pick(when: Date) {
		onPick(when);
	}

	function confirmCustom() {
		if (!customWhen || customError) return;
		onPick(customWhen);
	}

	function handleDocMouseDown(e: MouseEvent) {
		if (root && !root.contains(e.target as Node)) onClose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		onClose();
	}
</script>

<svelte:document onmousedown={handleDocMouseDown} onkeydowncapture={handleKey} />

<AnchoredMenu
	{anchor}
	bind:panel={root}
	extraClass="label-picker snooze-picker"
	role="dialog"
	label={m.mail_snooze_until()}
>
	<div class="menu-lbl">{m.mail_snooze_until()}</div>
	{#each presets as p (p.id)}
		<button type="button" class="mitem sp-row" onclick={() => pick(p.when)}>
			<Clock size={17} />
			<span class="sp-name">{p.label}</span>
			<span class="sp-when">{hint(p.when)}</span>
		</button>
	{/each}
	<div class="msep"></div>
	{#if custom}
		<div class="sp-custom">
			<input
				type="datetime-local"
				bind:value={customValue}
				min={toLocalInput(bounds.min)}
				max={toLocalInput(bounds.max)}
				aria-label={m.mail_snooze_input_aria()}
			/>
			{#if customWhen && !customError}
				<div class="sp-hint">{m.mail_snooze_comes_back({ when: formatWhenLong(customWhen, now).toLowerCase() })}</div>
			{:else}
				<div class="sp-hint bad">{RANGE_MESSAGES[customError ?? 'invalid']()}</div>
			{/if}
			<button
				type="button"
				class="sp-go"
				disabled={!customWhen || !!customError}
				onclick={confirmCustom}
			>
				{m.mail_snooze_confirm()}
			</button>
		</div>
	{:else}
		<button type="button" class="mitem" onclick={() => (custom = true)}>
			<CalendarClock size={17} />{m.mail_pick_date_time()}
		</button>
	{/if}
</AnchoredMenu>
