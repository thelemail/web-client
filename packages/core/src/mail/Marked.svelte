<script lang="ts">
	import type { SearchSpan } from './data';

	interface Props {
		text: string;
		spans: readonly SearchSpan[];
		lead?: boolean;
		trail?: boolean;
	}

	let { text, spans, lead = false, trail = false }: Props = $props();

	const pieces = $derived.by(() => {
		const out: { text: string; hit: boolean }[] = [];
		let at = 0;
		for (const s of spans) {
			const start = Math.max(at, Math.min(s.start, text.length));
			const end = Math.min(text.length, Math.max(start, s.end));
			if (start > at) out.push({ text: text.slice(at, start), hit: false });
			if (end > start) out.push({ text: text.slice(start, end), hit: true });
			at = end;
		}
		if (at < text.length) out.push({ text: text.slice(at), hit: false });
		return out;
	});
</script>

{#if lead}…{/if}{#each pieces as piece, i (i)}{#if piece.hit}<mark class="hl">{piece.text}</mark>{:else}{piece.text}{/if}{/each}{#if trail}…{/if}
