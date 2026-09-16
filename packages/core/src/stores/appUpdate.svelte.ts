import { platform } from '$platform';
import type { AvailableUpdate, UpdateProgress, UpdateStatus } from '$core/platform/types';
import { restartBlockers } from './restartGuard';

const PROBLEMS: Record<string, string> = {
	translocated:
		'macOS is running Thelemail from a temporary location. Move the app to the Applications folder, open it from there, and install again.',
	'read-only':
		'Thelemail cannot replace itself in the folder it runs from. Download the new version from the release page instead.',
	unbundled: 'Development builds do not install updates.',
	verify: 'The download did not pass the signature checks, so nothing was installed.',
	download: 'The download did not finish. Check your connection and try again.',
	install: 'The new version could not be put in place. Thelemail is still on the version you had.',
	stale: 'The release changed since it was offered. Check again to see the current one.',
	busy: 'An update is already installing.',
	check: 'Could not reach the update server.'
};

export function describeUpdateProblem(code: string): string {
	return PROBLEMS[code] ?? 'The update did not install.';
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
