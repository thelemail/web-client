<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { cn } from "$core/utils.js";
	import type { WithoutChildrenOrChild } from "$core/utils.js";
	import TooltipPortal from "./tooltip-portal.svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 6,
		side = "top",
		children,
		portalProps,
		...restProps
	}: TooltipPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof TooltipPortal>>;
	} = $props();
</script>

<TooltipPortal {...portalProps}>
	<TooltipPrimitive.Content
		bind:ref
		data-slot="tooltip-content"
		{sideOffset}
		{side}
		class={cn("tooltip", className)}
		{...restProps}
	>
		{@render children?.()}
		<TooltipPrimitive.Arrow class="tooltip-arrow" width={10} height={5} />
	</TooltipPrimitive.Content>
</TooltipPortal>
