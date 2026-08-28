<script lang="ts">
	interface Props {
		initials: string;
		size?: number;
		bg?: string;
		fg?: string;
		src?: string | null;
		imgBg?: string;
		class?: string;
	}

	let {
		initials,
		size = 30,
		bg = 'var(--pine-100)',
		fg = 'var(--pine-700)',
		src = null,
		imgBg,
		class: className = ''
	}: Props = $props();

	let failed = $state(false);

	$effect(() => {
		void src;
		failed = false;
	});

	const showImage = $derived(!!src && !failed);
</script>

<span
	class={'av ' + className}
	style:width={size + 'px'}
	style:height={size + 'px'}
	style:font-size={Math.round(size * 0.4) + 'px'}
	style:background={showImage && imgBg ? imgBg : bg}
	style:color={fg}
	style:border-radius="var(--radius-avatar)"
	style:padding={showImage ? '1px' : null}
>
	{#if showImage}
		<img {src} alt="" onerror={() => (failed = true)} />
	{:else}
		{initials}
	{/if}
</span>

<style>
	.av {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		font-weight: 600;
		letter-spacing: 0.01em;
		overflow: hidden;
	}
	.av img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: inherit;
		display: block;
	}
</style>
