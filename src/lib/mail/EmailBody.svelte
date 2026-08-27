<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';

	interface Props {
		srcDoc: string;
	}

	let { srcDoc }: Props = $props();
	let frame: HTMLIFrameElement | undefined = $state();

	function applyTheme() {
		if (!frame) return;
		try {
			frame.contentDocument?.documentElement?.setAttribute('data-theme', theme.resolved);
		} catch {
			return;
		}
	}

	function fit() {
		if (!frame) return;
		try {
			const d = frame.contentDocument;
			if (!d) return;
			frame.style.height = Math.max(60, d.documentElement.scrollHeight) + 'px';
		} catch {
		}
	}

	$effect(() => {
		void theme.resolved;
		applyTheme();
	});
</script>

{#key srcDoc}
	<iframe
		bind:this={frame}
		class="email-frame"
		title="Message"
		sandbox="allow-same-origin allow-popups"
		srcdoc={srcDoc}
		onload={() => {
			applyTheme();
			fit();
		}}
	></iframe>
{/key}
