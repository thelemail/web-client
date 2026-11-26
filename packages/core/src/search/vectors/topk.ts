export interface Scored {
	item: number;
	score: number;
}

export interface HeldGroup {
	group: number;
	score: number;
	items: Scored[];
}

export class GroupHeap {
	readonly capacity: number;
	readonly perGroup: number;
	#group: number[] = [];
	#score: number[] = [];
	#slot = new Map<number, number>();
	#items = new Map<number, Scored[]>();

	constructor(capacity: number, perGroup = 1) {
		this.capacity = capacity;
		this.perGroup = perGroup;
	}

	get size(): number {
		return this.#group.length;
	}

	threshold(): number {
		return this.#group.length < this.capacity ? -Infinity : this.#score[0];
	}

	#worse(a: number, b: number): boolean {
		return this.#score[a] < this.#score[b] || (this.#score[a] === this.#score[b] && this.#group[a] > this.#group[b]);
	}

	#swap(a: number, b: number): void {
		const g = this.#group[a];
		const s = this.#score[a];
		this.#group[a] = this.#group[b];
		this.#score[a] = this.#score[b];
		this.#group[b] = g;
		this.#score[b] = s;
		this.#slot.set(this.#group[a], a);
		this.#slot.set(this.#group[b], b);
	}

	#up(i: number): void {
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!this.#worse(i, parent)) return;
			this.#swap(i, parent);
			i = parent;
		}
	}

	#down(i: number): void {
		const n = this.#group.length;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let m = i;
			if (l < n && this.#worse(l, m)) m = l;
			if (r < n && this.#worse(r, m)) m = r;
			if (m === i) return;
			this.#swap(i, m);
			i = m;
		}
	}

	#keep(group: number, item: number, score: number): void {
		const list = this.#items.get(group);
		if (!list) {
			this.#items.set(group, [{ item, score }]);
			return;
		}
		if (list.length >= this.perGroup && score <= list[list.length - 1].score) return;
		let i = list.length;
		while (i > 0 && list[i - 1].score < score) i--;
		list.splice(i, 0, { item, score });
		if (list.length > this.perGroup) list.pop();
	}

	offer(group: number, score: number, item: number): void {
		const slot = this.#slot.get(group);
		if (slot !== undefined) {
			this.#keep(group, item, score);
			if (score > this.#score[slot]) {
				this.#score[slot] = score;
				this.#down(slot);
			}
			return;
		}
		if (this.#group.length < this.capacity) {
			this.#group.push(group);
			this.#score.push(score);
			this.#slot.set(group, this.#group.length - 1);
			this.#keep(group, item, score);
			this.#up(this.#group.length - 1);
			return;
		}
		const min = this.#score[0];
		if (score < min || (score === min && group > this.#group[0])) return;
		const evicted = this.#group[0];
		this.#slot.delete(evicted);
		this.#items.delete(evicted);
		this.#group[0] = group;
		this.#score[0] = score;
		this.#slot.set(group, 0);
		this.#keep(group, item, score);
		this.#down(0);
	}

	groups(): HeldGroup[] {
		return this.#group
			.map((group, i) => ({ group, score: this.#score[i], items: this.#items.get(group) ?? [] }))
			.sort((a, b) => b.score - a.score || a.group - b.group);
	}
}
