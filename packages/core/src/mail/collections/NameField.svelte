<script lang="ts">
	import type { MailCollectionKind } from '$core/api/types';
	import { ruleText, type NameProblem } from './rules';

	interface Props {
		value: string;
		kind: MailCollectionKind;
		problem: NameProblem | null;
		label: string;
		id?: string;
		placeholder?: string;
		reveal?: boolean;
		disabled?: boolean;
		autofocus?: boolean;
	}

	let {
		value = $bindable(),
		kind,
		problem,
		label,
		id,
		placeholder = label,
		reveal = false,
		disabled = false,
		autofocus = false
	}: Props = $props();

	const uid = $props.id();
	let edited = $state(false);

	const message = $derived(problem && (edited || reveal) ? ruleText(kind, problem) : null);
</script>

<div class="cc-field">
	<input
		{id}
		type="text"
		bind:value
		{placeholder}
		aria-label={label}
		aria-invalid={message ? 'true' : undefined}
		aria-describedby={message ? `${uid}-err` : undefined}
		autocomplete="off"
		spellcheck="false"
		{disabled}
		oninput={() => (edited = true)}
		{@attach (node) => {
			if (!autofocus) return;
			node.focus();
			node.select();
		}}
	/>
	{#if message}
		<div class="cc-err" id={`${uid}-err`}>{message}</div>
	{/if}
</div>
