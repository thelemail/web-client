<script lang="ts">
	import { formatNumber } from '$core/i18n/intl';
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { Chip } from '$core/components/ui/chip';
	import {
		faArrowTurnDownLeft,
		faClockRotateLeft,
		faFolder,
		faMagnifyingGlass,
		faTag,
		faUser,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { mailSearch } from '$core/stores/search.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { composeStore } from '$core/stores/compose.svelte';
	import { formatRowTime, type Message } from './data';
	import { loadSearchStrip } from './searchStrip';

	interface Props {
		placeholder?: string;
		operators?: boolean;
	}

	let { placeholder = m.mail_search_placeholder(), operators = true }: Props = $props();

	const OPERATORS = ['from:', 'is:unread', 'is:starred', 'has:attachment', 'in:', 'label:'];
	const MAX_HISTORY = 5;
	const MAX_NAMES = 6;
	const uid = $props.id();
	const listId = `${uid}-list`;
	const errorId = `${uid}-error`;
	const progressId = `${uid}-progress`;

	type Option =
		| { kind: 'match'; key: string; msg: Message }
		| { kind: 'op'; key: string; op: string }
		| { kind: 'history'; key: string; text: string }
		| { kind: 'word'; key: string; text: string }
		| { kind: 'person'; key: string; name: string; address: string }
		| { kind: 'collection'; key: string; type: 'label' | 'folder'; path: string }
		| { kind: 'all'; key: string };

	let inputRef: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let dismissed = $state(false);
	let highlight = $state(-1);
	let composing = $state(false);

	const inMail = $derived(/\/u\/\d+\/mail(\/|$)/.test(page.url.pathname));
	const typed = $derived(mailSearch.draft.trim());
	const lastToken = $derived(mailSearch.draft.split(/\s+/).at(-1) ?? '');
	const invalid = $derived(!!mailSearch.error && mailSearch.draft === mailSearch.committed);

	const opSuggestions = $derived.by<string[]>(() => {
		if (!operators) return [];
		if (!typed) return OPERATORS;
		const token = lastToken.toLowerCase();
		if (!token || token.includes(':')) return [];
		return OPERATORS.filter((op) => op.startsWith(token) && op !== token);
	});

	const collectionSuggestions = $derived.by<Option[]>(() => {
		const match = /^(-?)(label|in):"?([^"]*)$/i.exec(lastToken);
		if (!match) return [];
		const type = match[2].toLowerCase() === 'label' ? 'label' : 'folder';
		const want = match[3].toLowerCase();
		const pool = type === 'label' ? mailCollections.labels : mailCollections.folders;
		return pool
			.filter((c) => !c.sealed && c.path.toLowerCase().includes(want))
			.slice(0, MAX_NAMES)
			.map((c) => ({ kind: 'collection', key: `c-${c.id}`, type, path: c.path }));
	});

	const options = $derived.by<Option[]>(() => {
		const out: Option[] = [];
		for (const text of (typed ? mailSearch.historyMatches(mailSearch.draft) : mailSearch.history).slice(0, MAX_HISTORY)) {
			out.push({ kind: 'history', key: `h-${text}`, text });
		}
		out.push(...collectionSuggestions);
		if (typed && !lastToken.includes(':')) {
			for (const p of mailSearch.completions.people) out.push({ kind: 'person', key: `p-${p.address}`, name: p.name, address: p.address });
			for (const w of mailSearch.completions.terms) out.push({ kind: 'word', key: `w-${w}`, text: w });
		}
		if (typed) {
			for (const msg of mailSearch.preview) out.push({ kind: 'match', key: `m-${msg.id}`, msg });
		}
		for (const op of opSuggestions) out.push({ kind: 'op', key: `o-${op}`, op });
		if (typed) out.push({ kind: 'all', key: 'all' });
		return out;
	});

	const indexing = $derived(mailSearch.indexing);
	const progressText = $derived.by(() => {
		const p = indexing;
		if (!p) return '';
		const args = { done: fmt(p.done), total: fmt(p.total) };
		switch (p.state) {
			case 'model':
				return m.mail_search_progress_model({ done: mb(p.done), total: mb(p.total) });
			case 'preparing':
				return m.mail_search_progress_preparing();
			case 'meaning':
				return m.mail_search_progress_meaning(args);
			case 'listing':
				return m.mail_search_progress_listing(args);
			case 'previews':
				return m.mail_search_progress_previews(args);
			case 'paused':
				return m.mail_search_progress_paused(args);
			case 'attention':
				return m.mail_search_progress_attention(args);
			default:
				return m.mail_search_progress_reading(args);
		}
	});
	const describedBy = $derived([invalid ? errorId : null, indexing ? progressId : null].filter(Boolean).join(' ') || undefined);
	const open = $derived(focused && !dismissed && !composing && (options.length > 0 || indexing !== null));

	function fmt(n: number): string {
		return formatNumber(n);
	}
	function mb(bytes: number): string {
		return formatNumber(bytes / 1_000_000, { maximumFractionDigits: 0 });
	}
	const activeId = $derived(open && highlight >= 0 && highlight < options.length ? `${uid}-${options[highlight].key}` : undefined);
	const showLooking = $derived(typed.length > 0 && mailSearch.previewing && mailSearch.preview.length === 0);
	const showNoPreview = $derived(typed.length > 0 && !mailSearch.previewing && mailSearch.preview.length === 0 && !opSuggestions.length);

	function folderBase(): string {
		const slot = page.params.slot ?? '0';
		const folder = page.params.folder;
		const usable = folder && folder !== 'drafts' && folder !== 'scheduled' ? folder : 'inbox';
		return `/u/${slot}/mail/${usable}`;
	}

	function openMatch(msg: Message) {
		dismissed = true;
		if (msg.match?.kind === 'draft') {
			composeStore.openDraft(msg.id);
			return;
		}
		if (msg.match?.kind === 'scheduled') {
			void goto(`/u/${page.params.slot ?? '0'}/mail/scheduled`);
			return;
		}
		void goto(`${folderBase()}/${msg.id}${page.url.search}`, { replace: !!page.params.id, reset: false });
	}

	function replaceLast(text: string) {
		const parts = mailSearch.draft.split(/(\s+)/);
		parts[parts.length - 1] = text;
		mailSearch.setDraft(parts.join(''));
		highlight = -1;
		inputRef?.focus();
	}

	function quoted(value: string): string {
		return /[\s"():{}]/.test(value) ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : value;
	}

	function applyOperator(op: string) {
		const draft = mailSearch.draft;
		const parts = draft.split(/(\s+)/);
		const last = parts.at(-1) ?? '';
		const replace = last && !last.includes(':') && op.startsWith(last.toLowerCase());
		const base = replace ? parts.slice(0, -1).join('') : draft.length && !/\s$/.test(draft) ? `${draft} ` : draft;
		mailSearch.setDraft(`${base}${op}`);
		highlight = -1;
		inputRef?.focus();
	}

	function commit(text?: string) {
		dismissed = true;
		highlight = -1;
		mailSearch.commit(text);
	}

	function choose(option: Option) {
		switch (option.kind) {
			case 'match':
				openMatch(option.msg);
				return;
			case 'op':
				applyOperator(option.op);
				return;
			case 'history':
				commit(option.text);
				return;
			case 'word':
				replaceLast(`${option.text} `);
				return;
			case 'person':
				replaceLast(`from:${option.address} `);
				return;
			case 'collection': {
				const neg = lastToken.startsWith('-') ? '-' : '';
				replaceLast(`${neg}${option.type === 'label' ? 'label' : 'in'}:${quoted(option.path)} `);
				return;
			}
			case 'all':
				commit();
		}
	}

	function clearAll() {
		mailSearch.clear();
		highlight = -1;
		dismissed = false;
		inputRef?.focus();
	}

	function handleKey(e: KeyboardEvent) {
		const el = document.activeElement;
		const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
		if (!inMail) return;
		if (e.key === '/' && !typing) {
			e.preventDefault();
			inputRef?.focus();
		}
	}

	function handleInputKey(e: KeyboardEvent) {
		if (e.isComposing || composing || e.keyCode === 229) return;
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
		if (composing) return;
		mailSearch.setDraft((e.currentTarget as HTMLInputElement).value);
		dismissed = false;
		highlight = -1;
	}

	function handleCompositionEnd(e: CompositionEvent) {
		composing = false;
		mailSearch.setDraft((e.currentTarget as HTMLInputElement).value);
		dismissed = false;
		highlight = -1;
	}

	const CHANNEL = { words: m.mail_search_channel_words, meaning: m.mail_search_channel_meaning, both: m.mail_search_channel_both } as const;
</script>

<svelte:document onkeydown={handleKey} />

<div class="searchwrap">
	<div class="search-field search">
		<Icon icon={faMagnifyingGlass} size={15} />
		<input
			bind:this={inputRef}
			class="field-input"
			role="combobox"
			aria-expanded={open && options.length > 0}
			aria-controls={open && options.length > 0 ? listId : undefined}
			aria-activedescendant={activeId}
			aria-autocomplete="list"
			aria-invalid={invalid || undefined}
			aria-describedby={describedBy}
			autocomplete="off"
			spellcheck="false"
			dir="auto"
			value={mailSearch.draft}
			oninput={handleInput}
			onkeydown={handleInputKey}
			oncompositionstart={() => (composing = true)}
			oncompositionend={handleCompositionEnd}
			onfocus={() => {
				focused = true;
				dismissed = false;
				mailSearch.warm();
				void loadSearchStrip().catch(() => undefined);
			}}
			onblur={() => {
				focused = false;
				highlight = -1;
			}}
			{placeholder}
			aria-label={placeholder}
		/>
		{#if invalid}
			<span id={errorId} class="sr-only">{mailSearch.error}</span>
		{/if}
		{#if indexing}
			<span id={progressId} class="sr-only">{progressText}</span>
			<span class="srch-track" aria-hidden="true">
				<span class="srch-line" class:paused={indexing.state === 'paused'} class:warn={indexing.state === 'attention'} style:width="{indexing.fraction * 100}%"></span>
			</span>
		{/if}
		{#if mailSearch.draft || mailSearch.active}
			<button class="clr" onclick={clearAll} title={m.mail_search_clear()} aria-label={m.mail_search_clear()}><Icon icon={faXmark} size={14} /></button>
		{:else}
			<kbd aria-hidden="true">/</kbd>
		{/if}
	</div>
	{#if open}
		<div class="srch-pop">
			{#if options.length > 0}
				<div class="srch-list" id={listId} role="listbox" aria-label={m.mail_search_suggestions()}>
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
								<span class="sm-from" dir="auto">{option.msg.from}</span>
								<span class="sm-subj" dir="auto">{option.msg.subj}</span>
								<span class="sm-when">
									{#if option.msg.match?.channel}<span class="sm-chan">{CHANNEL[option.msg.match.channel]()}</span>{/if}
									{formatRowTime(new Date(option.msg.epoch))}
								</span>
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
								<Chip size="sm">{option.op}</Chip>
							</div>
						{:else if option.kind === 'all'}
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
								<Icon icon={faMagnifyingGlass} size={14} />
								<span dir="auto">{m.mail_search_show_all({ query: typed })}</span>
								<Icon icon={faArrowTurnDownLeft} size={13} />
							</div>
						{:else}
							<div
								id="{uid}-{option.key}"
								class="srch-opt srch-hint"
								class:on={i === highlight}
								role="option"
								tabindex="-1"
								aria-selected={i === highlight}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => choose(option)}
								onkeydown={() => {}}
							>
								{#if option.kind === 'history'}
									<Icon icon={faClockRotateLeft} size={14} aria-hidden="true" />
									<span class="sh-text" dir="auto">{option.text}</span>
									<span class="sh-kind">{m.mail_search_group_history()}</span>
								{:else if option.kind === 'person'}
									<Icon icon={faUser} size={14} aria-hidden="true" />
									<span class="sh-text" dir="auto">{option.name || option.address}</span>
									{#if option.name}<span class="sh-sub" dir="auto">{option.address}</span>{/if}
								{:else if option.kind === 'collection'}
									{#if option.type === 'label'}<Icon icon={faTag} size={14} aria-hidden="true" />{:else}<Icon icon={faFolder} size={14} aria-hidden="true" />{/if}
									<span class="sh-text" dir="auto">{option.path}</span>
									<span class="sh-kind">{option.type === 'label' ? m.mail_search_group_label() : m.mail_search_group_folder()}</span>
								{:else}
									<Icon icon={faMagnifyingGlass} size={14} aria-hidden="true" />
									<span class="sh-text" dir="auto">{option.text}</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}
			{#if indexing}
				<div class="srch-progress" aria-hidden="true">
					<span>{progressText}</span>
					<span class="meter" class:paused={indexing.state === 'paused'} class:warn={indexing.state === 'attention'}><i style:width="{indexing.fraction * 100}%"></i></span>
				</div>
			{/if}
		</div>
	{/if}
</div>
