export type DnsState = 'ok' | 'warn' | 'fail' | 'pending';

export interface NewRecord {
	type: 'MX' | 'TXT';
	label?: string;
	host: string;
	ttl: string;
	value: string;
}

export type DeviceIcon = 'monitor' | 'smartphone' | 'globe';

export interface Person {
	name: string;
	addr: string;
	init: string;
	bg: string;
	fg: string;
}

export interface AccountMember extends Person {
	role: string;
	pending?: boolean;
}
