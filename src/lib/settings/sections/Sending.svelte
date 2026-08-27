<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Seg from '../Seg.svelte';
	import Toggle from '../Toggle.svelte';
	import Badge from '../Badge.svelte';
	import CardHead from '../CardHead.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	type EncOpt = { v: 'auto' | 'ask' | 'off'; icon: typeof Lock; t: string; d: string };
	const encOpts: EncOpt[] = [
		{ v: 'auto', icon: Lock, t: 'Encrypt automatically', d: 'Whenever a key is discovered.' },
		{
			v: 'ask',
			icon: CircleQuestionMark,
			t: 'Ask each time',
			d: 'Show a prompt before encrypting.'
		},
		{
			v: 'off',
			icon: LockOpen,
			t: 'Never automatically',
			d: 'Only when you turn it on in compose.'
		}
	];
</script>

<SecHead
	tag="03 — Composing & sending"
	title="Composing & sending"
	desc="How new messages start, the safety nets before they leave, and when mail is encrypted to the recipient."
/>

<div class="scard">
	<CardHead title="Compose defaults" />
	<Row t="Compose format">
		<Seg
			value={s.composeFormat}
			options={[
				{ v: 'rich', l: 'Rich text', icon: 'type' },
				{ v: 'plain', l: 'Plain text', icon: 'pilcrow' }
			]}
			onChange={(v) => set('composeFormat', v)}
		/>
	</Row>
	<Row t="Default font" d="For rich-text composing.">
		<Select
			value={s.composeFont}
			options={['Hanken Grotesk', 'Spectral', 'IBM Plex Mono', 'System sans']}
			onChange={(v) => set('composeFont', v)}
		/>
	</Row>
	<Row t="Undo send" d="A short window to recall a message after you hit send.">
		<Seg
			value={s.undo}
			options={[
				{ v: '0', l: 'Off' },
				{ v: '5', l: '5s' },
				{ v: '10', l: '10s' },
				{ v: '30', l: '30s' }
			]}
			onChange={(v) => set('undo', v)}
		/>
	</Row>
	<Row t="Auto-save drafts">
		<Select
			value={s.autosave}
			options={['Every few seconds', 'Every 30 seconds', 'Every minute', 'On close only']}
			onChange={(v) => set('autosave', v)}
		/>
	</Row>
	<Row t="Primary reply button" d="Which reply action sits in front.">
		<Seg
			value={s.replyDefault}
			options={[
				{ v: 'reply', l: 'Reply' },
				{ v: 'all', l: 'Reply all' }
			]}
			onChange={(v) => set('replyDefault', v)}
		/>
	</Row>
</div>

<div class="scard">
	<CardHead icon={ShieldAlert} title="Before a message leaves" />
	<Row t="Confirm external recipients" d="Ask before sending to anyone outside your domains.">
		<Toggle on={s.confirmExternal} onChange={(v) => set('confirmExternal', v)} />
	</Row>
	<Row t="Warn on empty subject">
		<Toggle on={s.confirmSubject} onChange={(v) => set('confirmSubject', v)} />
	</Row>
	<Row
		t="Warn before sending unencrypted"
		d="When a recipient has no key, flag that the message will leave in the clear."
	>
		<Toggle on={s.confirmUnencrypted} onChange={(v) => set('confirmUnencrypted', v)} />
	</Row>
</div>

<div class="scard encrypt-card">
	<CardHead icon={LockKeyhole} title="Encryption to external recipients">
		{#snippet right()}<Badge kind="pine" dot>WKD</Badge>{/snippet}
	</CardHead>
	<div class="encrypt-body">
		<p>
			When you message someone outside Thelemail, we look up their published PGP key (via
			<code>WKD</code>). You decide what happens when one is found — encrypting automatically can
			surprise a recipient who can’t decrypt, so this is yours to set.
		</p>
		<div class="enc-opts">
			{#each encOpts as o (o.v)}
				{@const Ic = o.icon}
				<button
					type="button"
					class="enc-opt"
					class:on={s.extEncrypt === o.v}
					onclick={() => set('extEncrypt', o.v)}
				>
					<span class="eo-radio"><span></span></span>
					<Ic size={17} />
					<div class="eo-text">
						<div class="eo-t">{o.t}</div>
						<div class="eo-d">{o.d}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
</div>
