<script lang="ts">
	import '$core/auth/auth.css';
	import type { Snippet } from 'svelte';
	import Wordmark from '$core/components/Wordmark.svelte';
	import SignedInStrip from './SignedInStrip.svelte';
	import StorageNotice from './StorageNotice.svelte';
	import LanguagePicker from '$core/i18n/LanguagePicker.svelte';

	let { children, strip = true }: { children: Snippet; strip?: boolean } = $props();
</script>

<div class="auth">
	<div class="langbar"><LanguagePicker /></div>
	<div class="stagebody">
		<a class="pagebrand" href="/" aria-label="Thelemail">
			<Wordmark size="large" />
		</a>
		<StorageNotice />
		{#if strip}<SignedInStrip />{/if}
		{@render children()}
	</div>
</div>
