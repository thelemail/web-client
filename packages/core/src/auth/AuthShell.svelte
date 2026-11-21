<script lang="ts">
	import '$core/auth/auth.css';
	import '$core/auth/sentence/sentence.css';
	import type { Snippet } from 'svelte';
	import Wordmark from '$core/components/Wordmark.svelte';
	import SignedInStrip from './SignedInStrip.svelte';
	import StorageNotice from './StorageNotice.svelte';
	import LanguagePicker from '$core/i18n/LanguagePicker.svelte';

	let { children, strip = true }: { children: Snippet; strip?: boolean } = $props();
</script>

<div class="auth">
	<header class="topbar">
		<a class="pagebrand" href="/" aria-label="Thelemail">
			<Wordmark />
		</a>
		<div class="langbar"><LanguagePicker /></div>
	</header>
	<div class="stagebody">
		<StorageNotice />
		{#if strip}<SignedInStrip />{/if}
		{@render children()}
	</div>
</div>
