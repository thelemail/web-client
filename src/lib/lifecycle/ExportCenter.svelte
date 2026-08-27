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

	let { ctx }: { ctx: LifecycleContext } = $props();

	const RELEASES = 'https://thelemail.com/export-tool';
	const DOWNLOADS = [
		{ os: 'macOS', Icon: Apple, href: `${RELEASES}/macos` },
		{ os: 'Windows', Icon: Monitor, href: `${RELEASES}/windows` },
		{ os: 'Linux', Icon: Terminal, href: `${RELEASES}/linux` }
	];
</script>

<div class="card lc-mid">
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Export your data</p>
			<h1>Download everything with the Thelemail Export Tool</h1>
			<p>
				Because your mail is end-to-end encrypted, the export runs on your own computer — the server
				never sees your keys or your messages. The tool handles mailboxes of any size and can resume
				if it's interrupted.
			</p>
		</div>

		<ul class="lc-changed">
			<li class="ch-h">What you get</li>
			<li><Mail size={16} /><span><b>All folders as standard MBOX</b> — imports cleanly into Apple Mail, Thunderbird and others, with attachments intact.</span></li>
			<li><KeyRound size={16} /><span><b>Your key material</b> — public key and your password-encrypted private key.</span></li>
			<li><Settings size={16} /><span><b>A settings and aliases snapshot</b> for {ctx.domain}.</span></li>
		</ul>

		<div class="lc-reassure"><ShieldCheck size={16} />Runs locally. Works even while an account is suspended.</div>

		<div class="lc-cta" style="margin-top:6px">
			{#each DOWNLOADS as d (d.os)}
				{@const Icon = d.Icon}
				<a class="btn btn-secondary" href={d.href} target="_blank" rel="noreferrer noopener">
					<Icon size={17} />{d.os}
				</a>
			{/each}
		</div>

		<ol class="lc-steps">
			<li><Download size={15} /><span>Download the tool for your system and open it.</span></li>
			<li><span class="lc-step-n">2</span><span>Sign in with your Thelemail address and password.</span></li>
			<li><HardDrive size={15} /><span>Pick a folder — everything is written there. Re-run any time to resume.</span></li>
		</ol>

		<p class="lc-cta-note">
			The tool is open source. While an export is running it holds your account's data for you, so a
			scheduled deletion won't proceed until you're safely done.
		</p>
	</div>
</div>
