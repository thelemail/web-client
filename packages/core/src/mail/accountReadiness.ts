export type AccountReadiness = 'ready' | 'syncing' | 'locked' | 'expired' | 'unavailable';

export type ProbeState = 'idle' | 'pending' | 'ok' | 'failed';

export interface ReadinessFacts {
	unlocked: boolean;
	restorable: boolean;
	sessionLost: boolean;
	probe: ProbeState;
	countsLoaded: boolean;
}

export function readinessOf(f: ReadinessFacts): AccountReadiness {
	if (!f.unlocked && !f.restorable) return 'locked';
	if (f.sessionLost) return 'expired';
	if (f.probe === 'failed') return 'unavailable';
	if (f.probe === 'pending' || !f.countsLoaded) return 'syncing';
	return 'ready';
}
