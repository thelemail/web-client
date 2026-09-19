import { platform } from '$platform';
import type { AvailableUpdate, UpdateProgress, UpdateStatus } from '$core/platform/types';
import { restartBlockers } from './restartGuard';
import { m } from '$paraglide/messages.js';

const PROBLEMS: Record<string, () => string> = {
	translocated: () => m.store_update_problem_translocated(),
	'read-only': () => m.store_update_problem_read_only(),
	unbundled: () => m.store_update_problem_unbundled(),
	verify: () => m.store_update_problem_verify(),
	download: () => m.store_update_problem_download(),
	install: () => m.store_update_problem_install(),
	stale: () => m.store_update_problem_stale(),
	busy: () => m.store_update_problem_busy(),
	check: () => m.store_update_problem_check()
};

export function describeUpdateProblem(code: string): string {
	return PROBLEMS[code]?.() ?? m.store_update_problem_generic();
}

function problemCode(err: unknown): string {
	if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
		return err.code;
	}
	return 'install';
}

class AppUpdate {
	status = $state<UpdateStatus | null>(null);
	available = $state<AvailableUpdate | null>(null);
	progress = $state<UpdateProgress | null>(null);
	problem = $state<string | null>(null);
	blockers = $state<string[]>([]);
	checking = $state(false);
	installing = $state(false);
	hidden = $state(false);
	#started = false;

	get supported(): boolean {
		return !!platform.updates;
	}

	get bannerVisible(): boolean {
		return !!this.available && !this.hidden;
	}

	start(): void {
		const native = platform.updates;
		if (this.#started || !native) return;
		this.#started = true;
		native.onAvailable((update) => {
			this.available = update;
			this.hidden = false;
		});
		native.onProgress((progress) => (this.progress = progress));
		void this.refresh();
	}

	async refresh(): Promise<void> {
		const native = platform.updates;
		if (!native) return;
		try {
			const status = await native.status();
			this.status = status;
			this.available = status.available;
			this.hidden = status.snoozed;
			this.installing = status.installing;
		} catch {
			this.status = null;
		}
	}

	async check(): Promise<void> {
		const native = platform.updates;
		if (!native || this.checking || this.installing) return;
		this.checking = true;
		this.problem = null;
		try {
			this.available = await native.check();
			this.hidden = false;
		} catch (err) {
			this.problem = describeUpdateProblem(problemCode(err));
		} finally {
			this.checking = false;
			await this.refresh();
			this.hidden = false;
		}
	}

	async later(): Promise<void> {
		const native = platform.updates;
		const update = this.available;
		if (!native || !update) return;
		this.hidden = true;
		this.problem = null;
		this.blockers = [];
		try {
			await native.snooze(update.version);
		} catch {
			return;
		}
	}

	async install(): Promise<void> {
		const native = platform.updates;
		const update = this.available;
		if (!native || !update || this.installing) return;
		this.problem = null;
		this.blockers = await restartBlockers();
		if (this.blockers.length > 0) return;
		this.installing = true;
		this.progress = null;
		try {
			await native.install(update.version);
		} catch (err) {
			this.installing = false;
			this.progress = null;
			this.problem = describeUpdateProblem(problemCode(err));
		}
	}

	openRelease(): void {
		const url = this.available?.releaseUrl ?? this.status?.releasesUrl;
		if (url) platform.openExternal(url);
	}
}

export const appUpdate = new AppUpdate();
