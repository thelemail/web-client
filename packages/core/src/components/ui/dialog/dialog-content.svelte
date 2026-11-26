<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import Icon from '$core/components/Icon.svelte';
	import { faXmark } from '@fortawesome/pro-regular-svg-icons';
	import { Button } from "$core/components/ui/button/index.js";
	import { m } from '$paraglide/messages.js';
	import { cn, type WithoutChildrenOrChild } from "$core/utils.js";
	import * as Dialog from "./index.js";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		size = "md",
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
		size?: "sm" | "md" | "wide" | "lg" | "xl";
	} = $props();
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn("dialog", size !== "md" && `dialog-${size}`, className)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" size="icon-sm" class="dialog-close" aria-label={m.common_close()} {...props} data-state={undefined}>
						<Icon icon={faXmark} />
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>
