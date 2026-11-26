<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { Button } from "$core/components/ui/button/index.js";
	import { m } from '$paraglide/messages.js';
	import { cn, type WithElementRef } from "$core/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn("dialog-footer", className)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="neutral" {...props}>{m.common_close()}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
