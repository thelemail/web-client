<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCircleExclamation,
		faLock,
		faLockOpen,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import { chipsFromInput, type Contact, type RecipientChip } from './data';
	import { insideMailbox } from './address';
	import Avatar from '$core/components/Avatar.svelte';
	import { Chip } from '$core/components/ui/chip';
	import { personAvatars } from '$core/stores/personAvatars.svelte';

	export type RecipientEncStatus =
		| 'internal'
		| 'encrypted'
		| 'cleartext'
		| 'checking'
		| 'failed'
		| null;

	interface Props {
		label: 'To' | 'Cc' | 'Bcc';
		chips: RecipientChip[];
		setChips: (next: RecipientChip[]) => void;
		contacts: Contact[];
		autoFocus?: boolean;
		rightSlot?: Snippet;
		onRemoveField?: () => void;
		encStatusFor?: (email: string) => RecipientEncStatus;
	}

	let {
		label,
		chips,
		setChips,
		contacts,
		autoFocus = false,
		rightSlot,
		onRemoveField,
		encStatusFor
	}: Props = $props();

	let text = $state('');
	let hi = $state(0);
	const uid = $props.id();
	let focused = $state(false);
	let inputRef: HTMLInputElement | undefined = $state();

	const taken = $derived(new Set(chips.map((c) => c.email.toLowerCase())));
	const q = $derived(text.trim().toLowerCase());
	const suggestions = $derived(
		q
			? contacts
					.filter(
						(c) =>
							!taken.has(c.email.toLowerCase()) &&
							(c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
					)
					.slice(0, 5)
			: []
	);

	function addChips(next: RecipientChip[]) {
		if (!next.length) return;
		const seen = new Set(chips.map((c) => c.email.toLowerCase()));
		const added: RecipientChip[] = [];
		for (const chip of next) {
			const key = chip.email.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			added.push(chip);
		}
		if (added.length) setChips([...chips, ...added]);
	}

	function commit(contact: Contact | null) {
		if (contact) {
			addChips([{ ...contact, valid: true }]);
		} else {
			addChips(chipsFromInput(text, contacts));
		}
		text = '';
		hi = 0;
	}

	function onPaste(e: ClipboardEvent) {
		const pasted = e.clipboardData?.getData('text') ?? '';
		if (!/[,;\n<]/.test(pasted)) return;
		e.preventDefault();
		const el = e.currentTarget as HTMLInputElement;
		const start = el.selectionStart ?? text.length;
		const end = el.selectionEnd ?? start;
		text = text.slice(0, start) + pasted + text.slice(end);
		commit(null);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === ',' || e.key === ';') {
			if (suggestions.length || (text.trim() && !insideMailbox(text))) {
				e.preventDefault();
				commit(suggestions[hi] ?? null);
			}
		} else if (e.key === 'Enter') {
			if (text.trim() || suggestions.length) {
				e.preventDefault();
				commit(suggestions[hi] ?? null);
			}
		} else if (e.key === 'Tab' && (text.trim() || suggestions.length)) {
			e.preventDefault();
			commit(suggestions[hi] ?? null);
		} else if (e.key === 'Backspace' && !text && chips.length) {
			setChips(chips.slice(0, -1));
		} else if (e.key === 'ArrowDown' && suggestions.length) {
			e.preventDefault();
			hi = Math.min(hi + 1, suggestions.length - 1);
		} else if (e.key === 'ArrowUp' && suggestions.length) {
			e.preventDefault();
			hi = Math.max(hi - 1, 0);
		}
	}

	function onBlur() {
		focused = false;
		if (text.trim()) commit(null);
	}

	function rowMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) inputRef?.focus();
	}

	function boxMouseDown(e: MouseEvent) {
		if ((e.target as HTMLElement).classList.contains('recip-box')) inputRef?.focus();
	}

	function removeChip(i: number) {
		setChips(chips.filter((_, j) => j !== i));
	}

	function keepRemoveLocal(e: MouseEvent) {
		if ((e.target as Element).closest('.chip-remove')) e.stopPropagation();
	}

	$effect(() => {
		if (autoFocus) inputRef?.focus();
	});

	const labelText = $derived(
		label === 'To' ? m.mail_recip_to() : label === 'Cc' ? m.mail_recip_cc() : m.mail_recip_bcc()
	);
</script>

<div class="recip-row" onmousedown={rowMouseDown} role="presentation">
	<span class="recip-label" id="{uid}-label">{labelText}</span>
	<div class="recip-box" class:focus={focused} onmousedown={boxMouseDown} role="presentation">
		{#each chips as c, i (i)}
			<Chip
				size="sm"
				class={['rchip', { bad: !c.valid }]}
				title={c.email}
				removeLabel={m.mail_recip_remove_chip({ address: c.email })}
				onremove={() => removeChip(i)}
				onclick={keepRemoveLocal}
			>
				{#snippet leading()}
					{#if c.valid}
						<Avatar
							initials={c.init}
							bg={c.bg}
							fg={c.fg}
							size={18}
							src={personAvatars.avatarUrl(c.email)}
							fit="cover"
						/>
					{:else}
						<Icon icon={faCircleExclamation} size={13} />
					{/if}
				{/snippet}
				<span class="rtx">{c.name === c.email ? c.email : c.name}</span>
				{#if c.valid && encStatusFor}
					{@const es = encStatusFor(c.email)}
					{#if es === 'encrypted' || es === 'internal'}
						<span class="renc ok" title={m.mail_recip_encrypted()}
							><Icon icon={faLock} size={11} aria-hidden="true" /><span class="sr-only">{m.mail_recip_encrypted()}</span></span
						>
					{:else if es === 'cleartext'}
						<span class="renc warn" title={m.mail_recip_cleartext()}
							><Icon icon={faLockOpen} size={11} aria-hidden="true" /><span class="sr-only">{m.mail_recip_cleartext()}</span></span
						>
					{/if}
				{/if}
			</Chip>
		{/each}
		<input
			bind:this={inputRef}
			class="recip-input"
			role="combobox"
			aria-labelledby="{uid}-label"
			aria-autocomplete="list"
			aria-expanded={focused && suggestions.length > 0}
			aria-controls="{uid}-list"
			aria-activedescendant={focused && suggestions[hi] ? `${uid}-opt-${hi}` : undefined}
			bind:value={text}
			placeholder={chips.length ? '' : label === 'To' ? 'name@domain.com' : m.mail_recip_add_people()}
			oninput={() => (hi = 0)}
			onpaste={onPaste}
			onkeydown={onKey}
			onfocus={() => (focused = true)}
			onblur={onBlur}
		/>
		{#if focused && suggestions.length > 0}
			<div class="ac-menu" role="listbox" id="{uid}-list" aria-labelledby="{uid}-label">
				{#each suggestions as c, i (c.email)}
					<div
						class="ac-item"
						class:active={i === hi}
						role="option"
						id="{uid}-opt-{i}"
						aria-selected={i === hi}
						tabindex="-1"
						onmousedown={(e) => {
							e.preventDefault();
							commit(c);
							inputRef?.focus();
						}}
						onmouseenter={() => (hi = i)}
					>
						<Avatar
							initials={c.init}
							bg={c.bg}
							fg={c.fg}
							size={28}
							src={personAvatars.avatarUrl(c.email)}
							fit="cover"
						/>
						<span class="ac-tx"><b>{c.name}</b><span>{c.email}</span></span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<div class="recip-right">
		{#if rightSlot}{@render rightSlot()}{/if}
		{#if onRemoveField}
			<button type="button" class="recip-x" title={m.mail_recip_remove_field({ field: labelText })} onclick={onRemoveField}>
				<Icon icon={faXmark} size={15} />
			</button>
		{/if}
	</div>
</div>
