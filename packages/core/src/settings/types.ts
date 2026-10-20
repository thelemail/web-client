export type DnsState = 'ok' | 'warn' | 'fail' | 'pending';

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
