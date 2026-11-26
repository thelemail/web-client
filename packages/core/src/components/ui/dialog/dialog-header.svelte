<script lang="ts">
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
	import Icon from "$core/components/Icon.svelte";
	import { cn, type WithElementRef } from "$core/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		icon,
		tone = "brand",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		icon?: IconDefinition;
		tone?: "brand" | "danger" | "warning";
	} = $props();
</script>

<div bind:this={ref} data-slot="dialog-header" class={cn("dialog-header", className)} {...restProps}>
	{#if icon}<span class="dialog-icon" data-tone={tone} aria-hidden="true"><Icon {icon} size={18} /></span>{/if}
	<div class="dialog-header-text">{@render children?.()}</div>
</div>
