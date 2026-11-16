const MiB = 1024 * 1024;

export interface FileLimits {
	maxInput: number;
	maxExpanded: number;
	maxEntries: number;
	maxRatio: number;
	maxDepth: number;
	maxNode: number;
	maxText: number;
	maxCells: number;
	maxPages: number;
	maxPart: number;
}

export const FILE_LIMITS: FileLimits = {
	maxInput: 25 * MiB,
	maxExpanded: 100 * MiB,
	maxEntries: 2000,
	maxRatio: 100,
	maxDepth: 64,
	maxNode: MiB,
	maxText: 8 * MiB,
	maxCells: 1_000_000,
	maxPages: 500,
	maxPart: 4096
};

export type FileState = 'complete' | 'partial' | 'password_required' | 'unsupported' | 'malformed';

export const FileWarning = {
	charset: 1 << 0,
	replacement: 1 << 1
} as const;

export interface FilePart {
	text: string;
	place: string;
}

export interface FileText {
	state: FileState;
	parts: FilePart[];
	warnings: number;
}

export class Stop extends Error {
	readonly state: Exclude<FileState, 'complete'>;

	constructor(state: Exclude<FileState, 'complete'>) {
		super(state);
		this.state = state;
	}
}

export type Tick = () => void;

export class Sink {
	readonly limits: FileLimits;
	readonly tick: Tick;
	parts: FilePart[] = [];
	warnings = 0;
	#size = 0;

	constructor(limits: FileLimits, tick: Tick) {
		this.limits = limits;
		this.tick = tick;
	}

	add(place: string, raw: string): void {
		const text = raw.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
		if (!text) return;
		if (text.includes('�')) this.warnings |= FileWarning.replacement;
		const room = this.limits.maxText - this.#size;
		if (text.length > room) {
			if (room > 0) this.parts.push({ place, text: text.slice(0, room) });
			this.#size = this.limits.maxText;
			throw new Stop('partial');
		}
		this.#size += text.length;
		this.parts.push({ place, text });
	}

	result(state: FileState = 'complete'): FileText {
		return { state, parts: this.parts, warnings: this.warnings };
	}
}

export class Chunker {
	#sink: Sink;
	#place: string;
	#buffer: string[] = [];
	#length = 0;

	constructor(sink: Sink, place: string) {
		this.#sink = sink;
		this.#place = place;
	}

	line(text: string): void {
		if (!text.trim()) return;
		if (this.#length > 0 && this.#length + text.length > this.#sink.limits.maxPart) this.flush();
		this.#buffer.push(text);
		this.#length += text.length + 1;
	}

	flush(): void {
		if (this.#buffer.length === 0) return;
		const text = this.#buffer.join('\n');
		this.#buffer = [];
		this.#length = 0;
		this.#sink.add(this.#place, text);
	}
}
