export interface Timed {
	startMin: number;
	endMin: number;
}

export interface Placed<T extends Timed> {
	item: T;
	column: number;
	columns: number;
}

export function packDay<T extends Timed>(items: T[]): Placed<T>[] {
	const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
	const placed: Placed<T>[] = [];
	let cluster: T[] = [];
	let clusterEnd = -1;

	const flush = () => {
		if (!cluster.length) return;
		const ends: number[] = [];
		const assigned = cluster.map((item) => {
			let column = ends.findIndex((end) => end <= item.startMin);
			if (column === -1) {
				column = ends.length;
				ends.push(0);
			}
			ends[column] = item.endMin;
			return { item, column };
		});
		for (const entry of assigned) placed.push({ ...entry, columns: ends.length });
		cluster = [];
	};

	for (const item of sorted) {
		if (cluster.length && item.startMin >= clusterEnd) {
			flush();
			clusterEnd = -1;
		}
		cluster.push(item);
		clusterEnd = Math.max(clusterEnd, item.endMin);
	}
	flush();
	return placed;
}

export function packAllDay<T extends { day: number; span: number }>(
	items: T[]
): (T & { row: number })[] {
	const rows: number[] = [];
	return [...items]
		.sort((a, b) => a.day - b.day || b.span - a.span)
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
