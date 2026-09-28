<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
	import { isRenderCancelled, openPdf, PdfOpenError, type PdfFailure } from './pdf';

	interface Props {
		blob: Blob;
		onReady?: () => void;
		onFail: (reason: PdfFailure) => void;
	}

	let { blob, onReady, onFail }: Props = $props();

	const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
	const GUTTER = 48;
	const MAX_FIT = 2;
	const MAX_CANVAS_PIXELS = 16_000_000;

	let zoomIndex = $state(2);
	let doc = $state.raw<PDFDocumentProxy | null>(null);
	let base = $state.raw<{ width: number; height: number } | null>(null);
	let width = $state(0);
	let current = $state(1);
	let scroller: HTMLDivElement | undefined = $state();

	$effect(() => {
		const source = blob;
		let cancelled = false;
		let opened: PDFDocumentProxy | null = null;
		doc = null;
		base = null;
		current = 1;
		void (async () => {
			try {
				const d = await openPdf(source);
				if (cancelled) {
					void d.loadingTask.destroy();
					return;
				}
				opened = d;
				const first = (await d.getPage(1)).getViewport({ scale: 1 });
				if (cancelled) return;
				base = { width: first.width, height: first.height };
				doc = d;
				onReady?.();
			} catch (err) {
				if (!cancelled) onFail(err instanceof PdfOpenError ? err.reason : 'failed');
			}
		})();
		return () => {
			cancelled = true;
			void opened?.loadingTask.destroy();
		};
	});

	const scale = $derived(
		base && width > GUTTER
			? Math.min((width - GUTTER) / base.width, MAX_FIT) * ZOOMS[zoomIndex]
			: 0
	);

	let observer: IntersectionObserver | null = null;
	const watchers = new Map<Element, (visible: boolean) => void>();

	function observe(el: HTMLElement, onChange: (visible: boolean) => void): () => void {
		if (!observer) {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) watchers.get(entry.target)?.(entry.isIntersecting);
				},
				{ root: scroller ?? null, rootMargin: '800px 0px' }
			);
		}
		watchers.set(el, onChange);
		observer.observe(el);
		return () => {
			observer?.unobserve(el);
			watchers.delete(el);
		};
	}

	$effect(() => () => {
		observer?.disconnect();
		observer = null;
		watchers.clear();
	});

	function page(n: number, s: number): Attachment<HTMLDivElement> {
		return (el) => {
			const pdf = doc;
			if (!pdf || !base || !s) return;
			el.style.width = `${base.width * s}px`;
			el.style.height = `${base.height * s}px`;
			let task: RenderTask | null = null;
			let canvas: HTMLCanvasElement | null = null;
			let drawn = false;
			let gone = false;

			async function draw() {
				if (drawn || !pdf) return;
				drawn = true;
				try {
					const p = await pdf.getPage(n);
					if (gone || !drawn) return;
					const view = p.getViewport({ scale: s });
					el.style.width = `${view.width}px`;
					el.style.height = `${view.height}px`;
					const density = Math.min(
						window.devicePixelRatio || 1,
						Math.sqrt(MAX_CANVAS_PIXELS / (view.width * view.height))
					);
					const out = p.getViewport({ scale: s * density });
					const c = document.createElement('canvas');
					c.width = Math.floor(out.width);
					c.height = Math.floor(out.height);
					task = p.render({ canvas: c, viewport: out });
					await task.promise;
					task = null;
					if (gone || !drawn) {
						c.width = 0;
						return;
					}
					canvas = c;
					el.replaceChildren(c);
				} catch (err) {
					drawn = false;
					if (!isRenderCancelled(err) && !gone) el.dataset.failed = '';
				}
			}

			function release() {
				drawn = false;
				task?.cancel();
				task = null;
				if (canvas) {
					canvas.width = 0;
					canvas = null;
				}
				el.replaceChildren();
			}

			const stop = observe(el, (visible) => (visible ? void draw() : release()));
			return () => {
				gone = true;
				stop();
				release();
			};
		};
	}

	async function setZoom(next: number) {
		const keep = current;
		zoomIndex = next;
		await tick();
		const target = scroller?.querySelectorAll<HTMLElement>('.apx-page')[keep - 1];
		if (scroller && target) scroller.scrollTop = target.offsetTop - 16;
	}

	function onScroll() {
		if (!scroller) return;
		const mark = scroller.scrollTop + scroller.clientHeight / 3;
		const pages = scroller.querySelectorAll<HTMLElement>('.apx-page');
		let n = 1;
		for (const [i, el] of pages.entries()) {
			if (el.offsetTop <= mark) n = i + 1;
			else break;
		}
		current = n;
	}
</script>

<div class="apx-pdf">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="apx-pdf-scroll" tabindex="0" role="region" aria-label={m.mail_preview_open()} bind:this={scroller} bind:clientWidth={width} onscroll={onScroll}>
		{#if doc && scale}
			{#each { length: doc.numPages }, i (i)}
				<div class="apx-page" {@attach page(i + 1, scale)}></div>
			{/each}
		{/if}
	</div>
	{#if doc}
		<div class="apx-pdf-bar">
			<button
				type="button"
				title={m.mail_preview_zoom_out()}
				disabled={zoomIndex === 0}
				onclick={() => setZoom(zoomIndex - 1)}
			>
				<Minus size={15} />
			</button>
			<span class="apx-pdf-pos">{m.mail_preview_page({ page: current, total: doc.numPages })}</span>
			<button
				type="button"
				title={m.mail_preview_zoom_in()}
				disabled={zoomIndex === ZOOMS.length - 1}
				onclick={() => setZoom(zoomIndex + 1)}
			>
				<Plus size={15} />
			</button>
		</div>
	{/if}
</div>
