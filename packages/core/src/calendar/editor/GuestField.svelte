<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { contacts } from '$core/stores/contacts.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import type { Attendee } from '../model';

	interface Props {
		value: Attendee[];
		exclude: string[];
		onChange: (next: Attendee[]) => void;
	}

	let { value, exclude, onChange }: Props = $props();

	let input = $state('');
	let focused = $state(false);

	const members = $derived(workspaces.members);

	const suggestions = $derived.by(() => {
		const q = input.trim().toLowerCase();
		const taken = new Set([...value.map((a) => a.email.toLowerCase()), ...exclude]);
		const pool: { email: string; name: string; internal: boolean }[] = [
			...members.map((m) => ({ email: m.email.toLowerCase(), name: m.fullName || m.email, internal: true })),
			...contacts.items.map((c) => ({ email: c.email.toLowerCase(), name: c.name || c.email, internal: false }))
		];
		const seen = new Set<string>();
		return pool
			.filter((p) => {
				if (taken.has(p.email) || seen.has(p.email)) return false;
				seen.add(p.email);
				return !q || p.email.includes(q) || p.name.toLowerCase().includes(q);
			})
			.slice(0, 6);
	});

	function isMember(email: string): boolean {
		return members.some((m) => m.email.toLowerCase() === email);
	}

	function add(email: string, name?: string) {
		const clean = email.trim().toLowerCase().replace(/^<|>$/g, '');
		if (!clean || !clean.includes('@')) return;
		if (value.some((a) => a.email.toLowerCase() === clean) || exclude.includes(clean)) {
			input = '';
			return;
		}
		onChange([
			...value,
			{ email: clean, name: name || undefined, partstat: 'needs-action', role: 'req', internal: isMember(clean) }
		]);
		input = '';
	}

	function remove(email: string) {
		onChange(value.filter((a) => a.email !== email));
	}

	function onKey(ev: KeyboardEvent) {
		if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
			ev.preventDefault();
			const first = suggestions[0];
			if (input.trim() && !input.includes('@') && first) add(first.email, first.name);
			else add(input);
		} else if (ev.key === 'Backspace' && !input && value.length) {
			remove(value[value.length - 1].email);
		}
	}
</script>

<div class="guests">
	<div class="guest-chips">
		{#each value as a (a.email)}
			<span class="guest-chip" class:external={!a.internal}>
				{a.name || a.email}
				<button type="button" aria-label="Remove {a.email}" onclick={() => remove(a.email)}>
					<X size={12} />
				</button>
			</span>
		{/each}
		<input
			type="text"
			placeholder={value.length ? '' : 'Add people by name or address'}
			bind:value={input}
			onkeydown={onKey}
			onfocus={() => (focused = true)}
			onblur={() => setTimeout(() => (focused = false), 150)}
		/>
	</div>
	{#if focused && suggestions.length}
		<div class="guest-suggest">
			{#each suggestions as s (s.email)}
				<button type="button" onmousedown={(e) => e.preventDefault()} onclick={() => add(s.email, s.name)}>
					<span>{s.name}</span>
					<span class="guest-mail">{s.email}{s.internal ? ' · member' : ''}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
