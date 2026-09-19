<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Mail from '@lucide/svelte/icons/mail';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Settings from '@lucide/svelte/icons/settings';
	import Apple from '@lucide/svelte/icons/apple';
	import Monitor from '@lucide/svelte/icons/monitor';
	import type { LifecycleContext } from './types';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { Button } from '$core/components/ui/button';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const RELEASES = 'https://thelemail.com/export-tool';
	const DOWNLOADS = [
		{ os: 'macOS', Icon: Apple, href: `${RELEASES}/macos` },
		{ os: 'Windows', Icon: Monitor, href: `${RELEASES}/windows` },
		{ os: 'Linux', Icon: Terminal, href: `${RELEASES}/linux` }
	];
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<div class="card lc-mid">
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.lc_export_eyebrow()}</p>
			<h1>{m.lc_export_title()}</h1>
			<p>
				{m.lc_export_intro()}
			</p>
		</div>

		<ul class="lc-changed">
			<li class="ch-h">{m.lc_export_get_heading()}</li>
			<li><Mail size={16} /><span><Rich text={m.lc_export_get_mbox()} tags={{ b: bold }} /></span></li>
			<li><KeyRound size={16} /><span><Rich text={m.lc_export_get_keys()} tags={{ b: bold }} /></span></li>
			<li><Settings size={16} /><span><Rich text={m.lc_export_get_settings({ domain: ctx.domain })} tags={{ b: bold }} /></span></li>
		</ul>

		<div class="lc-reassure"><ShieldCheck size={16} />{m.lc_export_reassure()}</div>

		<div class="lc-cta" style="margin-top:6px">
			{#each DOWNLOADS as d (d.os)}
				{@const Icon = d.Icon}
				<Button variant="secondary" size="lg" href={d.href} target="_blank" rel="noreferrer noopener">
					<Icon size={17} />{d.os}
				</Button>
			{/each}
		</div>

		<ol class="lc-steps">
			<li><Download size={15} /><span>{m.lc_export_step_download()}</span></li>
			<li><span class="lc-step-n">2</span><span>{m.lc_export_step_sign_in()}</span></li>
			<li><HardDrive size={15} /><span>{m.lc_export_step_folder()}</span></li>
		</ol>

		<p class="lc-cta-note">
			{m.lc_export_note()}
		</p>
	</div>
</div>
