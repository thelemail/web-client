<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faMinus } from '@fortawesome/pro-regular-svg-icons';
	import { cn, type WithoutChildrenOrChild } from "$core/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		children: childrenProp,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & {
		children?: Snippet;
	} = $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="dropdown-menu-checkbox-item"
	class={cn("menu-item menu-item-check", className)}
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<span
			class="menu-item-indicator"
			data-slot="dropdown-menu-checkbox-item-indicator"
		>
			{#if indeterminate}
				<Icon icon={faMinus}  />
			{:else if checked}
				<Icon icon={faCheck}  />
			{/if}
		</span>
		{@render childrenProp?.()}
	{/snippet}
</DropdownMenuPrimitive.CheckboxItem>
