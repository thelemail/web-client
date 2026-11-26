<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn, type WithElementRef } from "$core/utils.js";

	export const buttonVariants = tv({
		base: "btn",
		variants: {
			variant: {
				primary: "btn-primary",
				tonal: "btn-tonal",
				neutral: "btn-neutral",
				ghost: "btn-ghost",
				ghostDanger: "btn-ghost-danger",
				danger: "btn-danger",
				dangerSolid: "btn-danger-solid",
				caution: "btn-caution"
			},
			size: {
				sm: "btn-sm",
				md: "",
				lg: "btn-lg",
				"icon-xs": "btn-xs btn-icon",
				"icon-sm": "btn-sm btn-icon",
				icon: "btn-icon",
				"icon-lg": "btn-lg btn-icon"
			},
			block: {
				true: "btn-block"
			}
		},
		defaultVariants: {
			variant: "neutral",
			size: "md",
			block: false
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			block?: boolean;
			busy?: boolean;
			busyLabel?: string;
			tooltip?: string;
			shortcut?: string;
		};
</script>

<script lang="ts">
	import * as Tooltip from "$core/components/ui/tooltip/index.js";

	let {
		ref = $bindable(null),
		class: className,
		variant = "neutral",
		size = "md",
		block = false,
		busy = false,
		busyLabel = undefined,
		href = undefined,
		type = "button",
		disabled = false,
		onclick,
		tooltip,
		shortcut,
		children,
		...restProps
	}: ButtonProps = $props();

	const stacked = $derived(busyLabel !== undefined);

	function guard(e: MouseEvent & { currentTarget: EventTarget & (HTMLButtonElement | HTMLAnchorElement) }) {
		if (busy) {
			e.preventDefault();
			return;
		}
		(onclick as ((e: MouseEvent) => void) | null | undefined)?.(e);
	}
</script>

{#snippet content()}
	{#if stacked}
		<span class="btn-stack">
			<span class="btn-idle" aria-hidden={busy || undefined}>{@render children?.()}</span>
			<span class="btn-busy" aria-hidden={!busy || undefined}><span class="btn-spin"></span>{busyLabel}</span>
		</span>
	{:else}
		{@render children?.()}
	{/if}
{/snippet}

{#snippet element(extra: Record<string, unknown>)}
	{#if href}
		<a
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size, block }), className)}
			href={disabled ? undefined : href}
			aria-disabled={disabled || busy || undefined}
			aria-busy={busy || undefined}
			role={disabled ? "link" : undefined}
			tabindex={disabled ? -1 : undefined}
			{...restProps}
			{...extra}
			onclick={(e: MouseEvent & { currentTarget: EventTarget & (HTMLButtonElement | HTMLAnchorElement) }) => {
				(extra.onclick as ((e: MouseEvent) => void) | undefined)?.(e);
				guard(e);
			}}
		>
			{@render content()}
		</a>
	{:else}
		<button
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size, block }), className)}
			{type}
			{disabled}
			aria-disabled={busy || undefined}
			aria-busy={busy || undefined}
			{...restProps}
			{...extra}
			onclick={(e: MouseEvent & { currentTarget: EventTarget & (HTMLButtonElement | HTMLAnchorElement) }) => {
				(extra.onclick as ((e: MouseEvent) => void) | undefined)?.(e);
				guard(e);
			}}
		>
			{@render content()}
		</button>
	{/if}
{/snippet}

{#if tooltip}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render element({ ...props, "aria-label": restProps["aria-label"] ?? tooltip })}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{tooltip}{#if shortcut}<kbd>{shortcut}</kbd>{/if}</Tooltip.Content>
	</Tooltip.Root>
{:else}
	{@render element({})}
{/if}
{#if stacked}
	<span class="sr-only" role="status">{busy ? busyLabel : ""}</span>
{/if}
