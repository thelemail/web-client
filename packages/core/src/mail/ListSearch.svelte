<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { mailSearch } from '$core/stores/search.svelte';
	import { formatRowTime, type Message } from './data';

	interface Props {
		placeholder?: string;
		operators?: boolean;
	}

	let { placeholder = m.mail_search_placeholder(), operators = true }: Props = $props();

	const OPERATORS = ['from:', 'is:unread', 'is:starred', 'has:attachment', 'in:', 'label:'];
	const uid = $props.id();
	const listId = `${uid}-list`;

	type Option =
		| { kind: 'match'; key: string; msg: Message }
		| { kind: 'op'; key: string; op: string }
		| { kind: 'all'; key: string };

	let inputRef: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let dismissed = $state(false);
	let highlight = $state(-1);

	const inMail = $derived(/\/u\/\d+\/mail(\/|$)/.test(page.url.pathname));
	const typed = $derived(mailSearch.draft.trim());
	const lastToken = $derived(mailSearch.draft.split(/\s+/).at(-1) ?? '');

	const suggestions = $derived.by<string[]>(() => {
		if (!operators) return [];
		if (!typed) return OPERATORS;
		const token = lastToken.toLowerCase();
		if (!token || token.includes(':')) return [];
		return OPERATORS.filter((op) => op.startsWith(token) && op !== token);
	});

	const options = $derived.by<Option[]>(() => {
		const out: Option[] = [];
		if (typed) {
			for (const msg of mailSearch.preview) out.push({ kind: 'match', key: `m-${msg.id}`, msg });
		}
		for (const op of suggestions) out.push({ kind: 'op', key: `o-${op}`, op });
		if (typed) out.push({ kind: 'all', key: 'all' });
		return out;
	});

	const open = $derived(focused && !dismissed && options.length > 0);
	const activeId = $derived(open && highlight >= 0 && highlight < options.length ? `${uid}-${options[highlight].key}` : undefined);
	const showLooking = $derived(typed.length > 0 && mailSearch.previewing && mailSearch.preview.length === 0);
	const showNoPreview = $derived(
		typed.length > 0 && !mailSearch.previewing && mailSearch.preview.length === 0 && !suggestions.length
	);

	function folderBase(): string {
		const slot = page.params.slot ?? '0';
		const folder = page.params.folder;
		const usable = folder && folder !== 'drafts' && folder !== 'scheduled' ? folder : 'inbox';
		return `/u/${slot}/mail/${usable}`;
	}

	function openMatch(msg: Message) {
		dismissed = true;
		const target = `${folderBase()}/${msg.id}${page.url.search}`;
		void goto(target, { replace: !!page.params.id, reset: false });
	}

	function applyOperator(op: string) {
		const draft = mailSearch.draft;
		const parts = draft.split(/(\s+)/);
		const last = parts.at(-1) ?? '';
		const replaceLast = last && !last.includes(':') && op.startsWith(last.toLowerCase());
		const base = replaceLast ? parts.slice(0, -1).join('') : draft.length && !/\s$/.test(draft) ? `${draft} ` : draft;
		mailSearch.setDraft(`${base}${op}`);
		highlight = -1;
		inputRef?.focus();
	}

	function commit() {
		dismissed = true;
		highlight = -1;
		mailSearch.commit();
	}

	function choose(option: Option) {
		if (option.kind === 'match') openMatch(option.msg);
		else if (option.kind === 'op') applyOperator(option.op);
		else commit();
	}

	function clearAll() {
		mailSearch.clear();
		highlight = -1;
		dismissed = false;
		inputRef?.focus();
	}

	function handleKey(e: KeyboardEvent) {
		const el = document.activeElement;
		const typing =
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			(el instanceof HTMLElement && el.isContentEditable);
		if (!inMail) return;
		if (e.key === '/' && !typing) {
			e.preventDefault();
			inputRef?.focus();
		}
	}

	function handleInputKey(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!options.length) return;
			e.preventDefault();
			dismissed = false;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			const count = options.length;
			highlight = highlight < 0 ? (step > 0 ? 0 : count - 1) : (highlight + step + count) % count;
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (open && highlight >= 0 && highlight < options.length) {
				choose(options[highlight]);
				return;
			}
			if (typed || mailSearch.active) commit();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (open) {
				dismissed = true;
				highlight = -1;
				return;
			}
			mailSearch.clear();
			inputRef?.blur();
		}
	}

	function handleInput(e: Event) {
		mailSearch.setDraft((e.currentTarget as HTMLInputElement).value);
		dismissed = false;
		highlight = -1;
	}
</script>

<svelte:document onkeydown={handleKey} />

<div class="searchwrap">
	<div class="search">
		<Search size={16} />
		<input
			bind:this={inputRef}
			role="combobox"
			aria-expanded={open}
			aria-controls={open ? listId : undefined}
			aria-activedescendant={activeId}
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
			value={mailSearch.draft}
			oninput={handleInput}
			onkeydown={handleInputKey}
			onfocus={() => {
				focused = true;
				dismissed = false;
			}}
			onblur={() => {
				focused = false;
				highlight = -1;
			}}
			{placeholder}
			aria-label={placeholder}
		/>
		{#if mailSearch.draft || mailSearch.active}
			<button class="clr" onclick={clearAll} title={m.mail_search_clear()} aria-label={m.mail_search_clear()}
				><X size={14} /></button
			>
		{:else}
			<span class="kbd">/</span>
		{/if}
	</div>
	{#if open}
		<div class="srch-pop" id={listId} role="listbox" aria-label={m.mail_search_suggestions()}>
			{#each options as option, i (option.key)}
				{#if option.kind === 'match'}
					<div
						id="{uid}-{option.key}"
						class="srch-opt srch-match"
						class:on={i === highlight}
						role="option"
						tabindex="-1"
						aria-selected={i === highlight}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(option)}
						onkeydown={() => {}}
					>
						<span class="sm-from">{option.msg.from}</span>
						<span class="sm-subj">{option.msg.subj}</span>
						<span class="sm-when">{formatRowTime(new Date(option.msg.epoch))}</span>
					</div>
				{:else if option.kind === 'op'}
					<div
						id="{uid}-{option.key}"
						class="srch-opt srch-opchip"
						class:on={i === highlight}
						role="option"
						tabindex="-1"
						aria-selected={i === highlight}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(option)}
						onkeydown={() => {}}
					>
						<span class="srch-op">{option.op}</span>
					</div>
				{:else}
					{#if showLooking}
						<div class="srch-note" aria-hidden="true">{m.mail_search_looking()}</div>
					{:else if showNoPreview}
						<div class="srch-note" aria-hidden="true">{m.mail_search_no_preview()}</div>
					{/if}
					<div
						id="{uid}-{option.key}"
						class="srch-opt srch-all"
						class:on={i === highlight}
						role="option"
						tabindex="-1"
						aria-selected={i === highlight}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(option)}
						onkeydown={() => {}}
					>
						<Search size={14} />
						<span>{m.mail_search_show_all({ query: typed })}</span>
						<CornerDownLeft size={13} />
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
