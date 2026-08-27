<script lang="ts">
	import ImageOff from '@lucide/svelte/icons/image-off';
	import Image from '@lucide/svelte/icons/image';

	interface Props {
		sender: string | null | undefined;
		count?: number;
		onShow: () => void;
		onAlways: () => void;
	}

	let { sender, count, onShow, onAlways }: Props = $props();

	const domain = $derived(
		sender && sender.includes('@') ? sender.split('@')[1] : (sender ?? '')
	);
</script>

<div class="img-banner">
	<ImageOff size={15} />
	<span class="ib-h">
		{count && count > 1 ? `${count} remote images hidden` : 'Remote images hidden'}
	</span>
	<span class="ib-d">They can signal when and where you opened this message.</span>
	<button type="button" class="ib-btn primary" onclick={onShow}>
		<Image size={14} />Show
	</button>
	{#if domain}
		<button type="button" class="ib-btn" onclick={onAlways}>
			Always from <span class="mono">{domain}</span>
		</button>
	{/if}
</div>
