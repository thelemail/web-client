<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import Icon from '$core/components/Icon.svelte';
	import { faChevronRight } from '@fortawesome/pro-regular-svg-icons';
	import { cn } from "$core/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.SubTrigger
	bind:ref
	data-slot="dropdown-menu-sub-trigger"
	data-inset={inset}
	class={cn("menu-item", className)}
	{...restProps}
>
	{@render children?.()}
	<Icon icon={faChevronRight} class="ml-auto" />
</DropdownMenuPrimitive.SubTrigger>
