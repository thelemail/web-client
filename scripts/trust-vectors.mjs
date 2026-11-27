import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = 'packages/core/src/interop/trust.lock';
const REPO = 'thelemail/trust';
const SETS = [
	{ upstream: join('interop', 'vectors'), local: 'packages/core/src/interop/vectors', ext: '.json' },
	{ upstream: join('interop', 'ts'), local: 'packages/core/src/interop/generated', ext: '.ts' }
];

function files(dir, ext) {
	return readdirSync(dir)
		.filter((f) => f.endsWith(ext))
		.sort();
}

function update(source) {
	for (const set of SETS) {
		const from = join(source, set.upstream);
		if (!existsSync(from)) {
			throw new Error(`${from} does not exist`);
		}
		rmSync(set.local, { recursive: true, force: true });
		mkdirSync(set.local, { recursive: true });
		for (const f of files(from, set.ext)) {
			copyFileSync(join(from, f), join(set.local, f));
		}
		console.log(`copied ${files(set.local, set.ext).length} files from ${from}`);
	}
	const tag = process.argv[4];
	if (tag) {
		writeFileSync(LOCK, `${tag}\n`);
	}
}

function compare(upstream, local, ext, tag) {
	if (!existsSync(upstream)) {
		return [`${REPO}@${tag} has no ${upstream}`];
	}
	const want = files(upstream, ext);
	const have = existsSync(local) ? files(local, ext) : [];
	const failures = [];
	for (const f of want) {
		if (!have.includes(f)) {
			failures.push(`${f} is missing`);
		} else if (!readFileSync(join(upstream, f)).equals(readFileSync(join(local, f)))) {
			failures.push(`${f} differs from ${tag}`);
		}
	}
	for (const f of have) {
		if (!want.includes(f)) {
			failures.push(`${f} is not in ${tag}`);
		}
	}
	return failures;
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
		const failures = SETS.flatMap((set) => compare(join(dir, set.upstream), set.local, set.ext, tag));
		if (failures.length > 0) {
			throw new Error(failures.join('\n'));
		}
		console.log(`vectors and generated sources match ${REPO}@${tag}`);
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
