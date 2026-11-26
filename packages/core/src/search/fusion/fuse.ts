export const RRF_K = 60;

export type Channel = 'words' | 'meaning' | 'both';

export interface Ranked {
	key: string;
	date: number;
	tier: number;
}

export interface Fused {
	key: string;
	channel: Channel;
	tier: number;
	score: number;
	date: number;
	lexical: number | null;
	semantic: number | null;
}

export function fuse(lexical: readonly Ranked[], semantic: readonly Ranked[], limit: number): Fused[] {
	const all = new Map<string, Fused>();
	const add = (list: readonly Ranked[], side: 'lexical' | 'semantic') => {
		for (const [i, item] of list.entries()) {
			const rank = i + 1;
			let entry = all.get(item.key);
			if (!entry) {
				entry = { key: item.key, channel: side === 'lexical' ? 'words' : 'meaning', tier: 0, score: 0, date: item.date, lexical: null, semantic: null };
				all.set(item.key, entry);
			} else if (entry[side] === null) {
				entry.channel = 'both';
			} else {
				continue;
			}
			entry[side] = rank;
			entry.tier = Math.max(entry.tier, item.tier);
			entry.score += 1 / (RRF_K + rank);
		}
	};
	add(lexical, 'lexical');
	add(semantic, 'semantic');
	const out = [...all.values()].sort(compareFused);
	out.length = Math.min(out.length, limit);
	return out;
}

export function compareFused(a: Fused, b: Fused): number {
	return b.tier - a.tier || b.score - a.score || b.date - a.date || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
