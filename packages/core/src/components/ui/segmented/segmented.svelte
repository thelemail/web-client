<script lang="ts" module>
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";

	export interface SegmentedOption<T extends string = string> {
		value: T;
		label: string;
		icon?: IconDefinition;
		disabled?: boolean;
		hideLabel?: boolean;
	}
</script>

<script lang="ts" generics="T extends string">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import Icon from "$core/components/Icon.svelte";
	import { cn } from "$core/utils.js";

	let {
		value = $bindable(),
		options,
		onValueChange,
		size = "sm",
		block = false,
		disabled = false,
		class: className,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledby,
		"aria-describedby": ariaDescribedby,
		id,
		name
	}: {
		value: T | undefined;
		options: SegmentedOption<T>[];
		onValueChange?: (value: T) => void;
		size?: "sm" | "md";
		block?: boolean;
		disabled?: boolean;
		class?: string;
		"aria-label"?: string;
		"aria-labelledby"?: string;
		"aria-describedby"?: string;
		id?: string;
		name?: string;
	} = $props();

	const index = $derived(options.findIndex((o) => o.value === value));
</script>

<RadioGroupPrimitive.Root
	{id}
	{name}
	{disabled}
	value={value ?? ""}
	onValueChange={(v) => {
		value = v as T;
		onValueChange?.(v as T);
	}}
	orientation="horizontal"
	loop
	aria-label={ariaLabel}
	aria-labelledby={ariaLabelledby}
	aria-describedby={ariaDescribedby}
	data-slot="segmented"
	data-empty={index < 0 ? "" : undefined}
	class={cn("segmented", size === "md" && "segmented-md", block && "segmented-block", className)}
	style="--seg-n: {options.length}; --seg-i: {Math.max(index, 0)};"
>
	<span class="segmented-thumb" aria-hidden="true"></span>
	{#each options as option (option.value)}
		<RadioGroupPrimitive.Item
			value={option.value}
			disabled={option.disabled}
			class="segmented-item"
			aria-label={option.hideLabel ? option.label : undefined}
			title={option.hideLabel ? option.label : undefined}
		>
			{#if option.icon}<Icon icon={option.icon} size={14} />{/if}
			{#if !option.hideLabel}<span>{option.label}</span>{/if}
		</RadioGroupPrimitive.Item>
	{/each}
</RadioGroupPrimitive.Root>
