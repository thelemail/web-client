<script lang="ts">
	let {
		class: className = '',
		size = 'compact'
	}: {
		class?: string;
		size?: 'compact' | 'large';
	} = $props();
</script>

<span class={['wordmark', size === 'large' && 'large', className]}>Thelemail</span>

<style>
	.wordmark {
		font-family: var(--font-sans);
		font-size: 13.5px;
		font-weight: 680;
		letter-spacing: 0.22em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.large {
		font-size: 18px;
	}
</style>
