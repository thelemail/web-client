<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { theme } from '$core/stores/theme.svelte';
	import { platform } from '$platform';

	interface Props {
		srcDoc: string;
	}

	let { srcDoc }: Props = $props();
	let frame: HTMLIFrameElement | undefined = $state();
	let observer: ResizeObserver | null = null;
	let refit = 0;
	let paper = $state(false);

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
			const next = Math.max(60, d.documentElement.scrollHeight) + 'px';
			if (frame.style.height !== next) frame.style.height = next;
			frame.dataset.fitted = '1';
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

	function watch(doc: Document) {
		observer?.disconnect();
		observer = null;
		if (!doc.body || typeof ResizeObserver === 'undefined') return;
		observer = new ResizeObserver(() => {
			cancelAnimationFrame(refit);
			refit = requestAnimationFrame(fit);
		});
		observer.observe(doc.body);
	}

	function ready() {
		const doc = frame?.contentDocument;
		if (!doc) return;
		paper = doc.documentElement.classList.contains('html');
		applyTheme();
		fit();
		interceptLinks(doc);
		watch(doc);
	}

	$effect(() => () => {
		cancelAnimationFrame(refit);
		observer?.disconnect();
		observer = null;
	});

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
		class:paper
		title={m.mail_body_frame_title()}
		sandbox={platform.interceptFrameLinks ? 'allow-same-origin' : 'allow-same-origin allow-popups'}
		srcdoc={writeFrameDoc ? undefined : srcDoc}
		onload={writeFrameDoc ? fit : ready}
	></iframe>
{/key}
