<script lang="ts">
	import type { DowngradeFinding, DowngradePreview } from '$core/api/billing';
	import { formatBytes, groupsOf, severityLabel } from './downgrade';

	let { preview }: { preview: DowngradePreview } = $props();

	const groups = $derived(groupsOf(preview));
	const changed = $derived(groups.filter((g) => g.severity !== 'unaffected'));
	const unchanged = $derived(groups.find((g) => g.severity === 'unaffected'));

	function usedFraction(f: DowngradeFinding): number | null {
		const box = f.mailboxes?.[0];
		const quota = preview.storageBytesPerMailbox;
		if (!box || !quota) return null;
		return Math.min(1, box.bytesUsed / quota);
	}
</script>

{#each changed as group (group.severity)}
	<div class="lc-impact-group">
		<p class="lc-impact-head sev-{group.severity}">
			<span class="d"></span>{group.heading}
		</p>
		<ul class="lc-impact">
			{#each group.findings as f (f.capability)}
				<li>
					<span class="im-t">{f.title}</span>
					<p class="im-s">{f.summary}</p>
					{#if usedFraction(f) !== null}
						<div
							class="im-meter"
							role="img"
							aria-label="{formatBytes(f.mailboxes?.[0]?.bytesUsed)} of {formatBytes(
								preview.storageBytesPerMailbox
							)} used"
						>
							<i style="width:{(usedFraction(f) ?? 0) * 100}%"></i>
						</div>
					{/if}
					{#each f.domains ?? [] as d (d.domain)}
						{#if (d.addresses ?? []).length > 0}
							<ul class="im-addrs">
								{#each d.addresses ?? [] as addr (addr)}
									<li>{addr}</li>
								{/each}
							</ul>
						{/if}
					{/each}
					{#if (f.mailboxes ?? []).length > 1}
						<ul class="im-addrs">
							{#each f.mailboxes ?? [] as box (box.email)}
								<li>{box.email} · {formatBytes(box.bytesOver)} over</li>
							{/each}
						</ul>
					{/if}
					<span class="sr-only">{severityLabel(f.severity)}</span>
				</li>
			{/each}
		</ul>
	</div>
{/each}

{#if unchanged}
	<details class="lc-impact-rest">
		<summary>{unchanged.heading}</summary>
		<ul class="lc-impact">
			{#each unchanged.findings as f (f.capability)}
				<li>
					<span class="im-t">{f.title}</span>
					<p class="im-s">{f.summary}</p>
				</li>
			{/each}
		</ul>
	</details>
{/if}
