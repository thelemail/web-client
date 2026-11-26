<script lang="ts">
	import '$core/auth/auth.css';
	import '$core/auth/form/form.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import Logo from '$core/components/Logo.svelte';
	import { Button } from '$core/components/ui/button';
	import SignedInStrip from './SignedInStrip.svelte';
	import StorageNotice from './StorageNotice.svelte';
	import LanguagePicker from '$core/i18n/LanguagePicker.svelte';
	import { authSwitch } from './auth-switch';
	import { m } from '$paraglide/messages.js';

	let { children, strip = true }: { children: Snippet; strip?: boolean } = $props();

	const swap = $derived(authSwitch(page.url));
</script>

<div class="auth">
	<header class="topbar">
		<a class="pagebrand" href="/" aria-label="Thelemail">
			<Logo />
		</a>
		{#if swap}
			<div class="topswitch">
				<span>{swap.lead}</span>
				<Button variant="tonal" href={swap.href}>{swap.label}</Button>
			</div>
		{/if}
	</header>
	<div class="stagebody">
		<StorageNotice />
		{#if strip}<SignedInStrip />{/if}
		{@render children()}
	</div>
	<footer class="pagefoot">
		<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{m.auth_foot_terms()}</a>
		<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{m.auth_foot_privacy()}</a>
		<LanguagePicker />
	</footer>
</div>
