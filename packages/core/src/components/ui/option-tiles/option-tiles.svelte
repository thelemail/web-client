<script lang="ts" module>
	export interface OptionTile<T extends string = string> {
		value: T;
		title: string;
		description?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="T extends string">
	import type { Snippet } from "svelte";
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn } from "$core/utils.js";

	let {
		value = $bindable(),
		options,
		onValueChange,
		tile,
		minWidth,
		disabled = false,
		class: className,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledby,
		name
	}: {
		value: T | undefined;
		options: OptionTile<T>[];
		onValueChange?: (value: T) => void;
		tile?: Snippet<[OptionTile<T>, boolean]>;
		minWidth?: number;
		disabled?: boolean;
		class?: string;
		"aria-label"?: string;
		"aria-labelledby"?: string;
		name?: string;
	} = $props();
</script>

<RadioGroupPrimitive.Root
	{name}
	{disabled}
	value={value ?? ""}
	onValueChange={(v) => {
		value = v as T;
		onValueChange?.(v as T);
	}}
	loop
	aria-label={ariaLabel}
	aria-labelledby={ariaLabelledby}
	data-slot="option-tiles"
	class={cn("option-tiles", className)}
	style={minWidth ? `--tile-min: ${minWidth}px` : undefined}
>
	{#each options as option (option.value)}
		<RadioGroupPrimitive.Item value={option.value} disabled={option.disabled} class="option-tile">
			<span class="option-tile-head">
				<span class="option-tile-title">{option.title}</span>
				<span class="option-tile-mark" aria-hidden="true"></span>
			</span>
			{#if tile}
				{@render tile(option, option.value === value)}
			{:else if option.description}
				<span class="option-tile-desc">{option.description}</span>
			{/if}
		</RadioGroupPrimitive.Item>
	{/each}
</RadioGroupPrimitive.Root>
