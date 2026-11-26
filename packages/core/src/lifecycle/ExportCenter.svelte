<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faDisplay,
		faDownload,
		faEnvelope,
		faGear,
		faHardDrive,
		faKey,
		faShieldCheck,
		faTerminal
	} from '@fortawesome/pro-regular-svg-icons';
	import { faApple } from '@fortawesome/free-brands-svg-icons';
	import type { LifecycleContext } from './types';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { Button } from '$core/components/ui/button';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const RELEASES = 'https://thelemail.com/export-tool';
	const DOWNLOADS = [
		{ os: 'macOS', Icon: faApple, href: `${RELEASES}/macos` },
		{ os: 'Windows', Icon: faDisplay, href: `${RELEASES}/windows` },
		{ os: 'Linux', Icon: faTerminal, href: `${RELEASES}/linux` }
	];
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<div class="card lc-mid">
	<div class="card-surface">
		<div class="card-head">
			<p class="eyebrow">{m.lc_export_eyebrow()}</p>
			<h1>{m.lc_export_title()}</h1>
			<p>
				{m.lc_export_intro()}
			</p>
		</div>

		<ul class="lc-changed">
			<li class="ch-h">{m.lc_export_get_heading()}</li>
			<li><Icon icon={faEnvelope} size={16} /><span><Rich text={m.lc_export_get_mbox()} tags={{ b: bold }} /></span></li>
			<li><Icon icon={faKey} size={16} /><span><Rich text={m.lc_export_get_keys()} tags={{ b: bold }} /></span></li>
			<li><Icon icon={faGear} size={16} /><span><Rich text={m.lc_export_get_settings({ domain: ctx.domain })} tags={{ b: bold }} /></span></li>
		</ul>

		<div class="lc-reassure"><Icon icon={faShieldCheck} size={16} />{m.lc_export_reassure()}</div>

		<div class="lc-cta" style="margin-top:6px">
			{#each DOWNLOADS as d (d.os)}
				{@const glyph = d.Icon}
				<Button variant="secondary" size="lg" href={d.href} target="_blank" rel="noreferrer noopener">
					<Icon icon={glyph} size={17} />{d.os}
				</Button>
			{/each}
		</div>

		<ol class="lc-steps">
			<li><Icon icon={faDownload} size={15} /><span>{m.lc_export_step_download()}</span></li>
			<li><span class="lc-step-n">2</span><span>{m.lc_export_step_sign_in()}</span></li>
			<li><Icon icon={faHardDrive} size={15} /><span>{m.lc_export_step_folder()}</span></li>
		</ol>

		<p class="lc-cta-note">
			{m.lc_export_note()}
		</p>
	</div>
</div>
