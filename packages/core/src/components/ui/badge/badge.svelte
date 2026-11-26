<script lang="ts" module>
	export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "caution";
</script>

<script lang="ts">
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import Icon from "$core/components/Icon.svelte";
	import { cn, type WithElementRef } from "$core/utils.js";

	let {
		ref = $bindable(null),
		href,
		tone = "neutral",
		icon,
		count = false,
		size = "md",
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		tone?: BadgeTone;
		icon?: IconDefinition;
		count?: boolean;
		size?: "sm" | "md";
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	data-tone={tone}
	{href}
	class={cn("badge", count && "badge-count", size === "sm" && "badge-sm", className)}
	{...restProps}
>
	{#if icon}<Icon {icon} size={12} />{/if}
	{@render children?.()}
</svelte:element>
