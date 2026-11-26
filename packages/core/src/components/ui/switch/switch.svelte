<script lang="ts">
	import { Switch as SwitchPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$core/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = "default",
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: "sm" | "default";
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn("switch", size === "sm" && "switch-sm", className)}
	{...restProps}
>
	<SwitchPrimitive.Thumb data-slot="switch-thumb" class="switch-thumb" />
</SwitchPrimitive.Root>
