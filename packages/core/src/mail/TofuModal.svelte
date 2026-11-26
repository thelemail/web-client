<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faChevronDown,
		faChevronUp,
		faKey,
		faPaperPlane
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		recipient: Recipient;
		previousFingerprint: string | null;
		previousLastSeen: string | null;
		previousFirstSeen: string | null;
		currentFingerprint: string;
		shared: boolean;
		onSendAnyway: () => void;
		onCancel: () => void;
	}

	let {
		recipient,
		previousFingerprint,
		previousLastSeen,
		previousFirstSeen,
		currentFingerprint,
		shared,
		onSendAnyway,
		onCancel
	}: Props = $props();

	let what = $state(false);
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onCancel();
		}
	}
>
	<Dialog.Content alert showCloseButton={false}>
		<Dialog.Header icon={faKey} tone="warning" eyebrow={m.mail_tofu_eyebrow()}>
			<Dialog.Title>{m.mail_tofu_title({ name: recipient.name || recipient.email })}</Dialog.Title>
			<Dialog.Description>
				{#if shared}
					{m.mail_tofu_lede_shared()}
				{:else}
					{m.mail_tofu_lede()}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="dialog-body">
			<div class="tofu-fp">
				{#if previousLastSeen}
					<div class="tofu-fprow">
						<span class="tofu-fk">{m.mail_tofu_last_seen()}</span>
						<span class="tofu-fv">{previousLastSeen}</span>
					</div>
				{/if}
				{#if previousFirstSeen}
					<div class="tofu-fprow">
						<span class="tofu-fk">{m.mail_tofu_first_seen()}</span>
						<span class="tofu-fv">{previousFirstSeen}</span>
					</div>
				{/if}
				{#if previousFingerprint}
					<div class="tofu-fprow">
						<span class="tofu-fk">{m.mail_tofu_previously_pinned()}</span>
						<span class="tofu-fv mono">{previousFingerprint}</span>
					</div>
				{/if}
				<div class="tofu-fprow now">
					<span class="tofu-fk">{m.mail_tofu_now()}</span>
					<span class="tofu-fv mono">{currentFingerprint}</span>
				</div>
			</div>

			<button type="button" class="tofu-what" aria-expanded={what} onclick={() => (what = !what)}>
				{m.mail_tofu_what_changed()}
				{#if what}<Icon icon={faChevronUp} size={14} />{:else}<Icon icon={faChevronDown} size={14} />{/if}
			</button>
			{#if what}
				<p class="dialog-hint tofu-explainer">{m.mail_tofu_explainer()}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="neutral" onclick={onCancel}>{m.common_cancel()}</Button>
			<Button variant="caution" onclick={onSendAnyway}>
				<Icon icon={faPaperPlane} size={15} />{m.mail_tofu_send_anyway()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
