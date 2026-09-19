<script lang="ts">
	import Languages from '@lucide/svelte/icons/languages';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { m } from '$paraglide/messages.js';
	import { i18n, setAppLocale } from './locale.svelte';
	import { LOCALES, LOCALE_NAMES, isAppLocale, languageTag } from './locales';

	let { class: className = '' }: { class?: string } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="langpick {className}"
		aria-label={m.language_picker_label({ language: LOCALE_NAMES[i18n.locale] })}
	>
		<Languages size={16} strokeWidth={1.8} aria-hidden="true" />
		<span>{LOCALE_NAMES[i18n.locale]}</span>
		<ChevronDown size={14} aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-44" align="end">
		<DropdownMenu.RadioGroup
			value={i18n.locale}
			onValueChange={(value) => {
				if (isAppLocale(value)) setAppLocale(value);
			}}
		>
			{#each LOCALES as locale (locale)}
				<DropdownMenu.RadioItem value={locale} lang={languageTag(locale)}>
					{LOCALE_NAMES[locale]}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<style>
	:global(.langpick) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	:global(.langpick:hover),
	:global(.langpick[data-state='open']) {
		background: var(--surface);
		border-color: var(--border);
		color: var(--fg);
	}
	:global(.langpick:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
