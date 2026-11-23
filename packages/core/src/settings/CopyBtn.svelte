<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faCircleExclamation, faCopy } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';

	interface Props {
		text: string;
		small?: boolean;
		label?: string;
	}

	let { text, small = false, label }: Props = $props();

	let result = $state<'idle' | 'copied' | 'failed'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function write(): Promise<boolean> {
		if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false;
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	async function copy() {
		const ok = await write();
		result = ok ? 'copied' : 'failed';
		clearTimeout(timer);
		timer = setTimeout(() => (result = 'idle'), 1300);
	}

	const status = $derived(
		result === 'copied' ? m.common_copied() : result === 'failed' ? m.common_copy_failed() : ''
	);
	const iconSize = $derived(small ? 13 : 14);
</script>

<button
	type="button"
	class="copy-btn"
	class:sm={small}
	class:done={result === 'copied'}
	class:failed={result === 'failed'}
	onclick={copy}
	title={result === 'failed' ? m.common_copy_failed() : m.settings_copy_to_clipboard()}
	aria-label={label ?? m.common_copy()}
>
	{#if result === 'copied'}<Icon icon={faCheck} size={iconSize} />{:else if result === 'failed'}<Icon icon={faCircleExclamation}
			size={iconSize}
		/>{:else}<Icon icon={faCopy} size={iconSize} />{/if}
	{#if !small}<span aria-hidden="true">{status || (label ?? m.common_copy())}</span>{/if}
</button>
<span class="sr-only" aria-live="polite">{status}</span>
