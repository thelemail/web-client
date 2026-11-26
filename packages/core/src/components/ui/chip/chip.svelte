<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";
	import Icon from "$core/components/Icon.svelte";
	import { faCheck, faXmark } from "@fortawesome/pro-regular-svg-icons";
	import { cn } from "$core/utils.js";

	let {
		pressed = $bindable(),
		onPressedChange,
		onremove,
		removeLabel,
		href,
		size = "md",
		disabled = false,
		leading,
		children,
		onclick,
		class: className,
		...restProps
	}: Omit<HTMLAttributes<HTMLElement>, "children"> & {
		pressed?: boolean;
		onPressedChange?: (pressed: boolean) => void;
		onremove?: () => void;
		removeLabel?: string;
		href?: string;
		size?: "sm" | "md";
		disabled?: boolean;
		leading?: Snippet;
		children: Snippet;
	} = $props();

	const toggle = $derived(pressed !== undefined);
	const action = $derived(!toggle && !href && !onremove && onclick !== undefined);
	const classes = $derived(cn("chip", size === "sm" && "chip-sm", onremove && "chip-removable", className));

	function flip(e: MouseEvent & { currentTarget: EventTarget & HTMLElement }) {
		pressed = !pressed;
		onPressedChange?.(pressed);
		onclick?.(e);
	}
</script>

{#snippet body()}
	{#if toggle}<Icon icon={faCheck} size={13} class="chip-check" />{/if}
	{#if leading}<span class="chip-lead">{@render leading()}</span>{/if}
	<span class="chip-label">{@render children()}</span>
{/snippet}

{#if toggle}
	<button type="button" data-slot="chip" class={classes} aria-pressed={pressed} {disabled} onclick={flip} {...restProps}>
		{@render body()}
	</button>
{:else if action}
	<button type="button" data-slot="chip" class={classes} {disabled} {onclick} {...restProps}>{@render body()}</button>
{:else if href}
	<a data-slot="chip" class={classes} {href} {onclick} {...restProps}>{@render body()}</a>
{:else}
	<span data-slot="chip" class={classes} {...restProps}>
		{@render body()}
		{#if onremove}
			<button type="button" class="chip-remove" aria-label={removeLabel} title={removeLabel} {disabled} onclick={onremove}>
				<Icon icon={faXmark} size={12} />
			</button>
		{/if}
	</span>
{/if}
