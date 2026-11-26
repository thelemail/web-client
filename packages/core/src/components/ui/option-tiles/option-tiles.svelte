<script lang="ts" module>
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";

	export interface OptionTile<T extends string = string> {
		value: T;
		title: string;
		description?: string;
		icon?: IconDefinition;
		badge?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="T extends string">
	import type { Snippet } from "svelte";
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import Icon from "$core/components/Icon.svelte";
	import { Badge } from "$core/components/ui/badge";
	import { cn } from "$core/utils.js";

	let {
		value = $bindable(),
		options,
		onValueChange,
		leading,
		tile,
		minWidth,
		columns,
		disabled = false,
		class: className,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledby,
		name
	}: {
		value: T | undefined;
		options: OptionTile<T>[];
		onValueChange?: (value: T) => void;
		leading?: Snippet<[OptionTile<T>]>;
		tile?: Snippet<[OptionTile<T>, boolean]>;
		minWidth?: number;
		columns?: number;
		disabled?: boolean;
		class?: string;
		"aria-label"?: string;
		"aria-labelledby"?: string;
		name?: string;
	} = $props();

	const style = $derived(
		[minWidth && `--tile-min: ${minWidth}px`, columns && `--tile-cols: ${columns}`].filter(Boolean).join("; ") || undefined
	);
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
	class={cn("option-tiles", columns && "option-tiles-cols", className)}
	{style}
>
	{#each options as option (option.value)}
		<RadioGroupPrimitive.Item value={option.value} disabled={option.disabled} class="option-tile">
			<span class="option-tile-head">
				{#if leading}
					{@render leading(option)}
				{:else if option.icon}
					<span class="option-tile-icon" aria-hidden="true"><Icon icon={option.icon} size={18} /></span>
				{/if}
				<span class="option-tile-text">
					<span class="option-tile-title">
						{option.title}
						{#if option.badge}<Badge tone="brand" size="sm">{option.badge}</Badge>{/if}
					</span>
					{#if option.description && !tile}
						<span class="option-tile-desc">{option.description}</span>
					{/if}
				</span>
				<span class="option-tile-mark" aria-hidden="true"></span>
			</span>
			{#if tile}
				{@render tile(option, option.value === value)}
			{/if}
		</RadioGroupPrimitive.Item>
	{/each}
</RadioGroupPrimitive.Root>
