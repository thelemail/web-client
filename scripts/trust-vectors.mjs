import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VECTORS = 'packages/core/src/interop/vectors';
const LOCK = 'packages/core/src/interop/trust.lock';
const REPO = 'thelemail/trust';

function jsonFiles(dir) {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.sort();
}

function update(source) {
	const from = join(source, 'interop', 'vectors');
	if (!existsSync(from)) {
		throw new Error(`${from} does not exist`);
	}
	rmSync(VECTORS, { recursive: true, force: true });
	mkdirSync(VECTORS, { recursive: true });
	for (const f of jsonFiles(from)) {
		copyFileSync(join(from, f), join(VECTORS, f));
	}
	const tag = process.argv[4];
	if (tag) {
		writeFileSync(LOCK, `${tag}\n`);
	}
	console.log(`copied ${jsonFiles(VECTORS).length} vector files from ${from}`);
}

async function check() {
	const tag = readFileSync(LOCK, 'utf8').trim();
	const token = process.env.TRUST_READ_TOKEN;
	if (!token) {
		throw new Error('TRUST_READ_TOKEN is not set');
	}
	const res = await fetch(`https://api.github.com/repos/${REPO}/tarball/${encodeURIComponent(tag)}`, {
		headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
	});
	if (!res.ok) {
		throw new Error(`fetching ${REPO}@${tag} failed with HTTP ${res.status}`);
	}
	const dir = mkdtempSync(join(tmpdir(), 'trust-vectors-'));
	try {
		const archive = join(dir, 'trust.tar.gz');
		writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
		execFileSync('tar', ['-xzf', archive, '-C', dir, '--strip-components=1']);
		const upstream = join(dir, 'interop', 'vectors');
		if (!existsSync(upstream)) {
			throw new Error(`${REPO}@${tag} has no interop/vectors`);
		}
		const want = jsonFiles(upstream);
		const have = jsonFiles(VECTORS);
		const failures = [];
		for (const f of want) {
			if (!have.includes(f)) {
				failures.push(`${f} is missing`);
			} else if (!readFileSync(join(upstream, f)).equals(readFileSync(join(VECTORS, f)))) {
				failures.push(`${f} differs from ${tag}`);
			}
		}
		for (const f of have) {
			if (!want.includes(f)) {
				failures.push(`${f} is not in ${tag}`);
			}
		}
		if (failures.length > 0) {
			throw new Error(failures.join('\n'));
		}
		console.log(`${have.length} vector files match ${REPO}@${tag}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const mode = process.argv[2];
try {
	if (mode === '--update' && process.argv[3]) {
		update(process.argv[3]);
	} else if (mode === '--check') {
		await check();
	} else {
		console.error('usage: node scripts/trust-vectors.mjs --update <trust checkout> [tag] | --check');
		process.exit(2);
	}
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
