<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";
	import Icon from "$core/components/Icon.svelte";
	import { faMagnifyingGlass } from "@fortawesome/pro-regular-svg-icons";
	import { cn, type WithElementRef } from "$core/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(""),
		size = "md",
		shortcut,
		class: className,
		...restProps
	}: WithElementRef<Omit<HTMLInputAttributes, "type" | "size">> & {
		size?: "sm" | "md" | "lg";
		shortcut?: string;
	} = $props();
</script>

<label class={cn("search-field", className)} data-slot="search-field">
	<Icon icon={faMagnifyingGlass} size={15} />
	<input
		bind:this={ref}
		bind:value
		type="search"
		class={cn("field-input", size === "sm" && "field-sm", size === "lg" && "field-lg")}
		{...restProps}
	/>
	{#if shortcut}<kbd aria-hidden="true">{shortcut}</kbd>{/if}
</label>
