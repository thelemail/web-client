<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import Content from "./tooltip-content.svelte";
	import type { TipTether } from "./shared";

	let { tether, side = "top" }: { tether: TipTether; side?: "top" | "bottom" | "left" | "right" } = $props();
</script>

<TooltipPrimitive.Root {tether} ignoreNonKeyboardFocus>
	{#snippet children({ payload })}
		{#if payload}
			<Content {side}>{payload.label}{#if payload.shortcut}<kbd>{payload.shortcut}</kbd>{/if}</Content>
		{/if}
	{/snippet}
</TooltipPrimitive.Root>
