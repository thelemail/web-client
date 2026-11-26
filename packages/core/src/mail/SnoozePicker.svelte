<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import { faCalendarClock, faClock } from '@fortawesome/pro-regular-svg-icons';
	import * as Popover from '$core/components/ui/popover';
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
</script>

<Popover.Root
	bind:open={
		() => true,
		(next) => {
			if (!next) onClose();
		}
	}
>
	<Popover.Content
		class="snooze-picker"
		customAnchor={anchor}
		side="bottom"
		align="end"
		collisionPadding={12}
		aria-label={m.mail_snooze_until()}
		portalProps={{ to: '.mail-app' }}
		onInteractOutside={(e) => {
			if (anchor?.contains(e.target as Node)) e.preventDefault();
		}}
	>
		<p class="popover-label">{m.mail_snooze_until()}</p>
		{#each presets as p (p.id)}
			<button type="button" class="menu-item sp-row" onclick={() => pick(p.when)}>
				<Icon icon={faClock} size={17} />
				<span class="sp-name">{p.label}</span>
				<span class="sp-when">{hint(p.when)}</span>
			</button>
		{/each}
		<div class="menu-sep"></div>
		{#if custom}
			<div class="sp-custom">
				<input
					class="field-input field-sm"
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
				<Button variant="primary" size="sm" disabled={!customWhen || !!customError} onclick={confirmCustom}>
					{m.mail_snooze_confirm()}
				</Button>
			</div>
		{:else}
			<button type="button" class="menu-item" onclick={() => (custom = true)}>
				<Icon icon={faCalendarClock} size={17} />{m.mail_pick_date_time()}
			</button>
		{/if}
	</Popover.Content>
</Popover.Root>
