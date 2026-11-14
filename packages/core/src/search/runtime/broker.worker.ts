/// <reference lib="webworker" />

export type BrokerRequest =
	| { op: 'claim'; accountId: string }
	| { op: 'own'; accountId: string }
	| { op: 'release'; accountId: string }
	| { op: 'connect'; accountId: string; port: MessagePort }
	| { op: 'bye' };

export type BrokerEvent =
	| { op: 'owner'; accountId: string; ready: boolean }
	| { op: 'connect'; accountId: string; port: MessagePort }
	| { op: 'none'; accountId: string };

const ports = new Set<MessagePort>();
const owners = new Map<string, MessagePort>();

function announce(accountId: string, ready: boolean, from: MessagePort): void {
	const event: BrokerEvent = { op: 'owner', accountId, ready };
	for (const port of ports) if (port !== from) port.postMessage(event);
}

function handle(port: MessagePort, r: BrokerRequest): void {
	switch (r.op) {
		case 'claim':
			owners.delete(r.accountId);
			announce(r.accountId, false, port);
			return;
		case 'own':
			owners.set(r.accountId, port);
			announce(r.accountId, true, port);
			return;
		case 'release':
			if (owners.get(r.accountId) === port) owners.delete(r.accountId);
			return;
		case 'connect': {
			const owner = owners.get(r.accountId);
			if (!owner) {
				r.port.close();
				port.postMessage({ op: 'none', accountId: r.accountId } satisfies BrokerEvent);
				return;
			}
			owner.postMessage({ op: 'connect', accountId: r.accountId, port: r.port } satisfies BrokerEvent, [r.port]);
			return;
		}
		case 'bye':
			for (const [accountId, owner] of owners) if (owner === port) owners.delete(accountId);
			ports.delete(port);
			port.close();
	}
}

(self as unknown as SharedWorkerGlobalScope).onconnect = (e) => {
	const port = e.ports[0];
	ports.add(port);
	port.onmessage = (m: MessageEvent<BrokerRequest>) => handle(port, m.data);
};
