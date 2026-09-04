import { minutes } from './format';
import type { Item } from './types';

export interface PlacedItem {
	item: Item;
	column: number;
	columns: number;
}

export function packDay(items: Item[]): PlacedItem[] {
	const sorted = [...items].sort((a, b) => minutes(a.start) - minutes(b.start));
	const placed: PlacedItem[] = [];
	let cluster: Item[] = [];
	let clusterEnd = -1;

	const flush = () => {
		if (!cluster.length) return;
		const ends: number[] = [];
		const assigned = cluster.map((item) => {
			let column = ends.findIndex((end) => end <= minutes(item.start));
			if (column === -1) {
				column = ends.length;
				ends.push(0);
			}
			ends[column] = minutes(item.end);
			return { item, column };
		});
		for (const entry of assigned) placed.push({ ...entry, columns: ends.length });
		cluster = [];
	};

	for (const item of sorted) {
		if (cluster.length && minutes(item.start) >= clusterEnd) {
			flush();
			clusterEnd = -1;
		}
		cluster.push(item);
		clusterEnd = Math.max(clusterEnd, minutes(item.end));
	}
	flush();
	return placed;
}

export function packAllDay<T extends { day: number; span: number }>(items: T[]): (T & { row: number })[] {
	const rows: number[] = [];
	return [...items]
		.sort((a, b) => a.day - b.day)
		.map((item) => {
			let row = rows.findIndex((end) => end <= item.day);
			if (row === -1) {
				row = rows.length;
				rows.push(0);
			}
			rows[row] = item.day + item.span;
			return { ...item, row: row + 1 };
		});
}
