export const JOB_CLASSES = ['metadata', 'body', 'attachments', 'embeddings', 'maintenance'] as const;
export type JobClass = (typeof JOB_CLASSES)[number];

export type StepOutcome = 'more' | 'idle' | 'blocked';

export interface StepContext {
	readonly signal: AbortSignal;
	shouldYield(): boolean;
}

export interface Job {
	readonly name: string;
	readonly class: JobClass;
	step(ctx: StepContext): Promise<StepOutcome>;
	receive?(message: unknown): void;
}

export interface Conditions {
	visible: boolean;
	idle: boolean;
	constrained: boolean;
}

export interface SchedulerOptions {
	yieldTask: () => Promise<void>;
	onChange?: () => void;
	onError?: (job: Job, error: unknown) => void;
}

interface Entry {
	job: Job;
	ready: boolean;
	blocked: boolean;
}

const RANK = new Map<JobClass, number>(JOB_CLASSES.map((c, i) => [c, i]));

export class Scheduler {
	#entries: Entry[] = [];
	#conditions: Conditions = { visible: false, idle: false, constrained: false };
	#foreground = 0;
	#running: Entry | null = null;
	#controller: AbortController | null = null;
	#loop: Promise<void> | null = null;
	#stopped = false;
	#waiters: (() => void)[] = [];
	#paused = new Set<JobClass>();
	#options: SchedulerOptions;

	constructor(options: SchedulerOptions) {
		this.#options = options;
	}

	get working(): JobClass | null {
		return this.#running?.job.class ?? null;
	}

	get paused(): boolean {
		return this.#paused.size > 0;
	}

	pause(classes: readonly JobClass[]): void {
		this.#paused = new Set(classes);
		if (this.#running && this.#paused.has(this.#running.job.class)) this.#controller?.abort();
		this.#kick();
		this.#options.onChange?.();
	}

	get blocked(): boolean {
		return this.#entries.some((e) => e.blocked);
	}

	register(job: Job): void {
		this.#entries.push({ job, ready: true, blocked: false });
		this.#entries.sort((a, b) => RANK.get(a.job.class)! - RANK.get(b.job.class)!);
		this.#kick();
	}

	tell(name: string, message: unknown): boolean {
		const entry = this.#entries.find((e) => e.job.name === name);
		if (!entry?.job.receive) return false;
		entry.job.receive(message);
		return true;
	}

	wake(name?: string): void {
		for (const e of this.#entries) {
			if (name === undefined || e.job.name === name) {
				e.ready = true;
				e.blocked = false;
			}
		}
		this.#kick();
	}

	setConditions(next: Conditions): void {
		this.#conditions = { ...next };
		this.#kick();
	}

	async foreground<T>(fn: () => Promise<T> | T): Promise<T> {
		this.#foreground++;
		try {
			return await fn();
		} finally {
			this.#foreground--;
			this.#kick();
		}
	}

	async stop(): Promise<void> {
		this.#stopped = true;
		this.#controller?.abort();
		this.#release();
		await this.#loop;
	}

	#allowed(): boolean {
		const c = this.#conditions;
		return !this.#stopped && this.#foreground === 0 && c.visible && c.idle && !c.constrained;
	}

	#next(): Entry | null {
		return this.#entries.find((e) => e.ready && !e.blocked && !this.#paused.has(e.job.class)) ?? null;
	}

	#preempts(current: Entry): boolean {
		const next = this.#next();
		return !!next && next !== current && RANK.get(next.job.class)! < RANK.get(current.job.class)!;
	}

	#release(): void {
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const w of waiters) w();
	}

	#kick(): void {
		this.#release();
		if (this.#loop || this.#stopped) return;
		if (!this.#allowed() || !this.#next()) return;
		this.#loop = this.#run().finally(() => {
			this.#loop = null;
			if (this.#allowed() && this.#next()) this.#kick();
		});
	}

	async #run(): Promise<void> {
		for (;;) {
			await this.#options.yieldTask();
			if (!this.#allowed()) return;
			const entry = this.#next();
			if (!entry) return;
			const controller = new AbortController();
			this.#controller = controller;
			this.#running = entry;
			this.#options.onChange?.();
			let outcome: StepOutcome;
			try {
				outcome = await entry.job.step({
					signal: controller.signal,
					shouldYield: () => controller.signal.aborted || !this.#allowed() || this.#preempts(entry)
				});
			} catch (error) {
				outcome = 'idle';
				if (!controller.signal.aborted) this.#options.onError?.(entry.job, error);
			}
			this.#running = null;
			this.#controller = null;
			if (outcome === 'idle') entry.ready = false;
			if (outcome === 'blocked') entry.blocked = true;
			this.#options.onChange?.();
		}
	}
}
