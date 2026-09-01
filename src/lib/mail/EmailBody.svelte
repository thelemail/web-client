<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
	import { platform } from '$platform';

	interface Props {
		srcDoc: string;
	}

	let { srcDoc }: Props = $props();
	let frame: HTMLIFrameElement | undefined = $state();

	const writeFrameDoc = platform.writeFrameDoc === true;

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

	function interceptLinks(doc: Document) {
		if (!platform.interceptFrameLinks) return;
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

	function ready() {
		const doc = frame?.contentDocument;
		if (!doc) return;
		applyTheme();
		fit();
		interceptLinks(doc);
	}

	$effect(() => {
		if (!writeFrameDoc || !frame) return;
		const doc = frame.contentDocument;
		if (!doc) return;
		doc.open();
		doc.write(srcDoc);
		doc.close();
		ready();
		const view = doc.defaultView;
		view?.addEventListener('load', fit);
		return () => view?.removeEventListener('load', fit);
	});
</script>

{#key srcDoc}
	<iframe
		bind:this={frame}
		class="email-frame"
		title="Message"
		sandbox={platform.interceptFrameLinks ? 'allow-same-origin' : 'allow-same-origin allow-popups'}
		srcdoc={writeFrameDoc ? undefined : srcDoc}
		onload={writeFrameDoc ? fit : ready}
	></iframe>
{/key}
