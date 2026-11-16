<script lang="ts">
	import { onMount } from 'svelte';
	import manifest from 'virtual:parser-assets';
	import { preload } from '../lib/assets';
	import { startFrame } from '../lib/frame';
	import { Pool, poolSize } from '../lib/pool';
	import { parentOrigin } from '../lib/origin';

	onMount(() => {
		let pool: Pool | null = null;
		startFrame(window, {
			parentOrigin,
			manifest,
			preload,
			runner(assets) {
				pool = new Pool({
					spawn: () => new Worker(new URL('../lib/parse.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-parser' }),
					assets,
					size: poolSize()
				});
				return pool;
			}
		});
		return () => pool?.close();
	});
</script>
