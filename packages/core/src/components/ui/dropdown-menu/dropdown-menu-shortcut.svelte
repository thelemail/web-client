<script lang="ts">
	import { cn, type WithElementRef } from "$core/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="dropdown-menu-shortcut"
	class={cn("menu-kbd", className)}
	{...restProps}
>
	{@render children?.()}
</span>
