<script lang="ts" module>
	export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "caution";
</script>

<script lang="ts">
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import {
		faCircleCheck,
		faCircleExclamation,
		faCircleMinus,
		faClock,
		faTriangleExclamation
	} from "@fortawesome/pro-regular-svg-icons";
	import Icon from "$core/components/Icon.svelte";
	import { cn, type WithElementRef } from "$core/utils.js";

	let {
		ref = $bindable(null),
		href,
		tone = "neutral",
		icon,
		status = false,
		count = false,
		size = "md",
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		tone?: BadgeTone;
		icon?: IconDefinition;
		status?: boolean;
		count?: boolean;
		size?: "sm" | "md";
	} = $props();

	const STATUS_ICON: Partial<Record<BadgeTone, IconDefinition>> = {
		success: faCircleCheck,
		warning: faTriangleExclamation,
		danger: faCircleExclamation,
		info: faClock,
		neutral: faCircleMinus
	};

	const shown = $derived(icon ?? (status ? STATUS_ICON[tone] : undefined));
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
	{#if shown}<Icon icon={shown} size={12} />{/if}
	{@render children?.()}
</svelte:element>
