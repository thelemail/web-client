<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn, type WithElementRef } from "$lib/utils.js";

	export const buttonVariants = tv({
		base: "btn",
		variants: {
			variant: {
				primary: "btn-primary",
				secondary: "btn-secondary",
				ghost: "btn-ghost",
				danger: "btn-danger",
				dangerSolid: "btn-danger-solid",
				caution: "btn-caution"
			},
			size: {
				lg: "btn-lg",
				md: "",
				sm: "btn-sm"
			},
			block: {
				true: "btn-block"
			}
		},
		defaultVariants: {
			variant: "secondary",
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
		};
</script>

<script lang="ts">
	let {
		ref = $bindable(null),
		class: className,
		variant = "secondary",
		size = "md",
		block = false,
		href = undefined,
		type = "button",
		disabled = false,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size, block }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled || undefined}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size, block }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
