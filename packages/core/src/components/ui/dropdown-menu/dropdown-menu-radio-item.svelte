<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
	import { cn, type WithoutChild } from "$core/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChild<DropdownMenuPrimitive.RadioItemProps> = $props();
</script>

<DropdownMenuPrimitive.RadioItem
	bind:ref
	data-slot="dropdown-menu-radio-item"
	class={cn("menu-item menu-item-check", className)}
	{...restProps}
>
	{#snippet children({ checked })}
		<span
			class="menu-item-indicator"
			data-slot="dropdown-menu-radio-item-indicator"
		>
			{#if checked}
				<Icon icon={faCheck}  />
			{/if}
		</span>
		{@render childrenProp?.({ checked })}
	{/snippet}
</DropdownMenuPrimitive.RadioItem>
