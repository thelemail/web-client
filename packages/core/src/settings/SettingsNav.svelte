<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Settings from '@lucide/svelte/icons/settings';
	import UserRound from '@lucide/svelte/icons/user-round';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Send from '@lucide/svelte/icons/send';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Bell from '@lucide/svelte/icons/bell';
	import Globe from '@lucide/svelte/icons/globe';
	import Globe2 from '@lucide/svelte/icons/globe-2';
	import Palette from '@lucide/svelte/icons/palette';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Upload from '@lucide/svelte/icons/upload';
	import UserX from '@lucide/svelte/icons/user-x';
	import FolderTree from '@lucide/svelte/icons/folder-tree';
	import Info from '@lucide/svelte/icons/info';
	import { page } from '$app/state';
	import { visibleGroups, sectionIdFromPath } from './data';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { platform } from '$platform';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	const groups = visibleGroups(platform);

	const icons: Record<string, typeof Settings> = {
		'user-round': UserRound,
		'at-sign': AtSign,
		send: Send,
		'mail-open': MailOpen,
		'shield-check': ShieldCheck,
		bell: Bell,
		globe: Globe,
		'globe-2': Globe2,
		palette: Palette,
		'credit-card': CreditCard,
		upload: Upload,
		'user-x': UserX,
		'folder-tree': FolderTree,
		info: Info
	};

	const slot = $derived(page.params.slot ?? '0');
	const current = $derived(sectionIdFromPath(page.url.pathname));
	const accountEmail = $derived(auth.email ?? '');
	const accountDomain = $derived(accountEmail.includes('@') ? accountEmail.split('@')[1] : '');
	const workspaceName = $derived(workspaces.workspace?.name ?? '');

	let strip: HTMLElement | undefined = $state();
	let moreStart = $state(false);
	let moreEnd = $state(false);

	const EDGE = 28;

	function measure() {
		if (!strip) return;
		const max = strip.scrollWidth - strip.clientWidth;
		moreStart = max > 1 && strip.scrollLeft > 1;
		moreEnd = max > 1 && strip.scrollLeft < max - 1;
	}

	function reveal() {
		const el = strip?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return;
		const left = el.offsetLeft;
		const right = left + el.offsetWidth;
		if (left < strip.scrollLeft + EDGE) strip.scrollLeft = Math.max(0, left - EDGE);
		else if (right > strip.scrollLeft + strip.clientWidth - EDGE) strip.scrollLeft = right - strip.clientWidth + EDGE;
	}

	function settle() {
		reveal();
		measure();
	}

	$effect(() => {
		void current;
		settle();
		let live = true;
		const frame = requestAnimationFrame(settle);
		void document.fonts?.ready.then(() => live && settle());
		return () => {
			live = false;
			cancelAnimationFrame(frame);
		};
	});
</script>

<svelte:window onresize={settle} />

<nav class="set-nav" aria-label={m.settings_nav_aria()}>
	<a class="set-back" href={`/u/${slot}/mail/inbox`}>
		<ArrowLeft size={16} /><span class="lbl">{m.settings_nav_back_to_inbox()}</span>
	</a>
	<div
		class="nav-groups"
		bind:this={strip}
		onscroll={measure}
		data-more-start={moreStart || undefined}
		data-more-end={moreEnd || undefined}
	>
		{#each groups as group (group.id)}
			<div class="nav-group">
				<div class="nav-eyebrow" id="snav-{group.id}">{group.label()}</div>
				<ul aria-labelledby="snav-{group.id}">
					{#each group.sections as sec (sec.id)}
						{@const Icon = icons[sec.icon] ?? UserRound}
						<li>
							<a
								class="snav"
								class:active={current === sec.id}
								href={`/u/${slot}/settings/${sec.id}`}
								aria-current={current === sec.id ? 'page' : undefined}
							>
								<Icon size={17} /><span class="lbl">{sec.label()}</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
	<div class="nav-foot">
		<Rich text={m.settings_nav_signed_in_as({ email: accountEmail })} tags={{ b: bold }} /><br />{workspaceName} · {accountDomain}
	</div>
</nav>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
