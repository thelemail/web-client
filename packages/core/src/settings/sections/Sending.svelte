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
	import { UNRELEASED, type SettingsState } from '../data';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	type EncOpt = { v: 'auto' | 'ask' | 'off'; icon: typeof Lock; t: string; d: string };
	const encOpts: EncOpt[] = $derived([
		{
			v: 'auto',
			icon: Lock,
			t: m.settings_sending_enc_auto(),
			d: m.settings_sending_enc_auto_desc()
		},
		{
			v: 'ask',
			icon: CircleQuestionMark,
			t: m.settings_sending_enc_ask(),
			d: m.settings_sending_enc_ask_desc()
		},
		{
			v: 'off',
			icon: LockOpen,
			t: m.settings_sending_enc_off(),
			d: m.settings_sending_enc_off_desc()
		}
	]);

	const AUTOSAVE_LABELS: Record<string, () => string> = {
		'Every few seconds': () => m.settings_sending_autosave_few_seconds(),
		'Every 30 seconds': () => m.settings_sending_autosave_30s(),
		'Every minute': () => m.settings_sending_autosave_minute(),
		'On close only': () => m.settings_sending_autosave_on_close()
	};
</script>

<SecHead desc={m.settings_sending_desc()} />

<div class="scard">
	<CardHead title={m.settings_sending_compose_title()} />
	{#if UNRELEASED.composeFormat}
		<Row t={m.settings_sending_compose_format()}>
			<Seg
				value={s.composeFormat}
				options={[
					{ v: 'rich', l: m.settings_sending_rich_text(), icon: 'type' },
					{ v: 'plain', l: m.settings_sending_plain_text(), icon: 'pilcrow' }
				]}
				onChange={(v) => set('composeFormat', v)}
			/>
		</Row>
	{/if}
	{#if UNRELEASED.composeFont}
		<Row t={m.settings_sending_font()} d={m.settings_sending_font_desc()}>
			<Select
				value={s.composeFont}
				options={[
					'Hanken Grotesk',
					'Spectral',
					'IBM Plex Mono',
					{ v: 'System sans', l: m.settings_sending_font_system() }
				]}
				onChange={(v) => set('composeFont', v)}
			/>
		</Row>
	{/if}
	{#if UNRELEASED.undoSend}
		<Row t={m.settings_sending_undo()} d={m.settings_sending_undo_desc()}>
			<Seg
				value={s.undo}
				options={[
					{ v: '0', l: m.settings_sending_undo_off() },
					{ v: '5', l: m.settings_sending_undo_seconds({ seconds: 5 }) },
					{ v: '10', l: m.settings_sending_undo_seconds({ seconds: 10 }) },
					{ v: '30', l: m.settings_sending_undo_seconds({ seconds: 30 }) }
				]}
				onChange={(v) => set('undo', v)}
			/>
		</Row>
	{/if}
	{#if UNRELEASED.draftAutosave}
		<Row t={m.settings_sending_autosave()}>
			<Select
				value={s.autosave}
				options={Object.entries(AUTOSAVE_LABELS).map(([v, l]) => ({ v, l: l() }))}
				onChange={(v) => set('autosave', v)}
			/>
		</Row>
	{/if}
	<Row t={m.settings_sending_reply_button()} d={m.settings_sending_reply_button_desc()}>
		<Seg
			value={s.replyDefault}
			options={[
				{ v: 'reply', l: m.settings_sending_reply() },
				{ v: 'all', l: m.settings_sending_reply_all() }
			]}
			onChange={(v) => set('replyDefault', v)}
		/>
	</Row>
</div>

<div class="scard">
	<CardHead icon={ShieldAlert} title={m.settings_sending_before_title()} />
	<Row
		t={m.settings_sending_confirm_external()}
		d={m.settings_sending_confirm_external_desc()}
	>
		<Toggle on={s.confirmExternal} onChange={(v) => set('confirmExternal', v)} />
	</Row>
	<Row t={m.settings_sending_warn_subject()}>
		<Toggle on={s.confirmSubject} onChange={(v) => set('confirmSubject', v)} />
	</Row>
	<Row
		t={m.settings_sending_warn_unencrypted()}
		d={m.settings_sending_warn_unencrypted_desc()}
	>
		<Toggle on={s.confirmUnencrypted} onChange={(v) => set('confirmUnencrypted', v)} />
	</Row>
</div>

{#if UNRELEASED.externalEncryptionPolicy}
	<div class="scard encrypt-card">
		<CardHead icon={LockKeyhole} title={m.settings_sending_ext_title()}>
			{#snippet right()}<Badge kind="pine" dot>WKD</Badge>{/snippet}
		</CardHead>
		<div class="encrypt-body">
			<p>
				<Rich text={m.settings_sending_ext_body()} tags={{ code }} />
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
{/if}

{#snippet code(t: string)}<code>{t}</code>{/snippet}
