import type { Database } from '@thelemail/sqlite-wasm';
import { ANALYZER_VERSION } from './analysis';

const WORDS = "tokenize = 'unicode61 remove_diacritics 2'";
const TRIGRAMS = "tokenize = 'trigram case_sensitive 0 remove_diacritics 1'";
const CONTENTLESS = "content = '', contentless_delete = 1, contentless_unindexed = 1";

export const MIGRATIONS: readonly string[] = [
	`
	CREATE TABLE meta (
		key TEXT PRIMARY KEY,
		value INTEGER NOT NULL
	) WITHOUT ROWID;

	CREATE TABLE sources (
		id INTEGER PRIMARY KEY,
		kind INTEGER NOT NULL,
		source_id TEXT NOT NULL,
		content_rev INTEGER NOT NULL,
		metadata_rev INTEGER NOT NULL,
		thread_id TEXT,
		message_id TEXT,
		date INTEGER NOT NULL,
		size INTEGER NOT NULL,
		flags INTEGER NOT NULL,
		known_flags INTEGER NOT NULL,
		UNIQUE (kind, source_id)
	);
	CREATE INDEX sources_date ON sources (date DESC, kind, source_id);
	CREATE INDEX sources_thread ON sources (thread_id) WHERE thread_id IS NOT NULL;
	CREATE INDEX sources_message_id ON sources (message_id) WHERE message_id IS NOT NULL;

	CREATE TABLE participants (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		role INTEGER NOT NULL,
		name TEXT NOT NULL,
		address TEXT NOT NULL,
		domain TEXT NOT NULL
	);
	CREATE INDEX participants_source ON participants (source);
	CREATE INDEX participants_address ON participants (address, role);
	CREATE INDEX participants_domain ON participants (domain, role);

	CREATE TABLE collections (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		collection_id TEXT NOT NULL,
		type INTEGER NOT NULL,
		PRIMARY KEY (source, collection_id)
	) WITHOUT ROWID;
	CREATE INDEX collections_member ON collections (collection_id, source);

	CREATE TABLE attachments (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		attachment_id TEXT NOT NULL,
		filename TEXT NOT NULL,
		mime TEXT NOT NULL,
		size INTEGER NOT NULL,
		PRIMARY KEY (source, attachment_id)
	) WITHOUT ROWID;

	CREATE TABLE coverage (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		dimension INTEGER NOT NULL,
		state INTEGER NOT NULL,
		PRIMARY KEY (source, dimension)
	) WITHOUT ROWID;
	CREATE INDEX coverage_state ON coverage (dimension, state);

	CREATE TABLE parts (
		id INTEGER PRIMARY KEY,
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		field INTEGER NOT NULL,
		attachment_id TEXT,
		locator INTEGER,
		text TEXT NOT NULL
	);
	CREATE INDEX parts_source ON parts (source);

	CREATE TABLE literals (
		id INTEGER PRIMARY KEY,
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		part INTEGER
	);
	CREATE INDEX literals_source ON literals (source);

	CREATE VIRTUAL TABLE parts_fts USING fts5 (
		body, source UNINDEXED, field UNINDEXED,
		${CONTENTLESS}, ${WORDS}
	);

	CREATE VIRTUAL TABLE literals_fts USING fts5 (
		body, source UNINDEXED, field UNINDEXED,
		${CONTENTLESS}, ${TRIGRAMS}
	);
	`,
	`
	ALTER TABLE attachments ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE sources ADD COLUMN list_id TEXT;
	CREATE INDEX sources_list ON sources (list_id) WHERE list_id IS NOT NULL;
	`
];

export const SCHEMA_VERSION = MIGRATIONS.length;

const REQUIRED_TABLES = [
	'meta',
	'sources',
	'participants',
	'collections',
	'attachments',
	'coverage',
	'parts',
	'literals',
	'parts_fts',
	'literals_fts'
];

export type SchemaState =
	| { kind: 'empty' }
	| { kind: 'current' }
	| { kind: 'behind'; version: number }
	| { kind: 'incompatible' };

function readMeta(db: Database, key: string): number | null {
	const value = db.selectValue('SELECT value FROM meta WHERE key = ?', [key]);
	return typeof value === 'number' ? value : null;
}

export function inspect(db: Database): SchemaState {
	const tables = new Set(db.selectValues("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')") as string[]);
	if (tables.size === 0) return { kind: 'empty' };
	if (!tables.has('meta')) return { kind: 'incompatible' };
	const version = readMeta(db, 'schema_version');
	const analyzer = readMeta(db, 'analyzer_version');
	if (version === null || version < 1 || version > SCHEMA_VERSION) return { kind: 'incompatible' };
	if (analyzer !== ANALYZER_VERSION) return { kind: 'incompatible' };
	if (version < SCHEMA_VERSION) return { kind: 'behind', version };
	if (REQUIRED_TABLES.some((t) => !tables.has(t))) return { kind: 'incompatible' };
	return { kind: 'current' };
}

export function migrate(db: Database, from: number): void {
	db.transaction('IMMEDIATE', () => {
		for (let v = from; v < SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v]);
		db.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?), (?, ?)', {
			bind: ['schema_version', SCHEMA_VERSION, 'analyzer_version', ANALYZER_VERSION]
		});
	});
}
