<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
	import { platform } from '$platform';

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

	function interceptLinks() {
		if (!platform.interceptFrameLinks) return;
		const doc = frame?.contentDocument;
		if (!doc) return;
		doc.addEventListener(
			'click',
			(ev) => {
				const target = ev.target as Element | null;
				const anchor = target?.closest?.('a[href]');
				if (!anchor) return;
				ev.preventDefault();
				const href = anchor.getAttribute('href');
				if (href) platform.openExternal(href);
			},
			true
		);
	}
</script>

{#key srcDoc}
	<iframe
		bind:this={frame}
		class="email-frame"
		title="Message"
		sandbox={platform.interceptFrameLinks ? "allow-same-origin" : "allow-same-origin allow-popups"}
		srcdoc={srcDoc}
		onload={() => {
			applyTheme();
			fit();
			interceptLinks();
		}}
	></iframe>
{/key}
