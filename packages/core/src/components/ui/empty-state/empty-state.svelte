<script lang="ts">
	import type { Snippet } from "svelte";
	import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
	import Icon from "$core/components/Icon.svelte";
	import { cn } from "$core/utils.js";

	let {
		icon,
		title,
		description,
		tone = "neutral",
		compact = false,
		action,
		children,
		class: className
	}: {
		icon?: IconDefinition;
		title: string;
		description?: string;
		tone?: "neutral" | "error";
		compact?: boolean;
		action?: Snippet;
		children?: Snippet;
		class?: string;
	} = $props();
</script>

<div
	class={cn("empty-state", compact && "empty-state-compact", className)}
	data-tone={tone}
	role={tone === "error" ? "alert" : undefined}
	data-slot="empty-state"
>
	{#if icon}<span class="empty-state-icon" aria-hidden="true"><Icon {icon} size={22} /></span>{/if}
	<p class="empty-state-title">{title}</p>
	{#if description}<p class="empty-state-text">{description}</p>{/if}
	{@render children?.()}
	{#if action}<div class="empty-state-action">{@render action()}</div>{/if}
</div>
