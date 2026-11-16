import { describe, expect, it } from 'vitest';
import type { ParsedQuery, QueryNode } from '../query/ast';
import { compile, knownOf, quote, render, universeOf, type Expr, type Plan, type QueryContext } from './compile';

const RANGE = { start: 0, end: 1 };

const HOSTILE = [
	'a" OR "b',
	'NEAR(a b, 0)',
	'body : x',
	'{body}:x',
	'parts_fts:x',
	"x'); DROP TABLE sources;--",
	'x) OR 1=1 --',
	'^xyz',
	'x" * "y',
	'a""b',
	'x\\"',
	'x AND y NOT z',
	'x; SELECT * FROM parts'
];

function ctx(value: string): QueryContext {
	return {
		identities: [`${value}@calloway.test`],
		folders: [{ id: `f-${value}`, path: value }],
		labels: [{ id: `l-${value}`, name: value }],
		attachmentText: true
	};
}

function shapes(value: string): QueryNode[] {
	return [
		{ kind: 'term', text: value, lane: 'word', range: RANGE },
		{ kind: 'term', text: value, lane: 'identifier', range: RANGE },
		{ kind: 'literal', text: value, lane: 'identifier', range: RANGE },
		{ kind: 'phrase', text: value, range: RANGE },
		{ kind: 'prefix', text: value, range: RANGE },
		{
			kind: 'around',
			left: { kind: 'term', text: value, lane: 'word', range: RANGE },
			right: { kind: 'phrase', text: `${value} x`, range: RANGE },
			distance: 3,
			range: RANGE
		},
		{ kind: 'field', field: 'subject', child: { kind: 'term', text: value, lane: 'word', range: RANGE }, range: RANGE },
		{ kind: 'participant', role: 'from', value: { kind: 'name', text: value, prefix: true }, range: RANGE },
		{ kind: 'participant', role: 'to', value: { kind: 'address', address: `${value}@x.test` }, range: RANGE },
		{ kind: 'filename', text: value, range: RANGE },
		{ kind: 'filetype', text: value, range: RANGE },
		{ kind: 'folder', path: value, range: RANGE },
		{ kind: 'label', name: value, range: RANGE },
		{ kind: 'deliveredto', address: `${value}@x.test`, range: RANGE },
		{ kind: 'list', value, range: RANGE },
		{ kind: 'msgid', id: value, range: RANGE }
	];
}

function parsed(root: QueryNode): ParsedQuery {
	return {
		root: { kind: 'and', children: [root, { kind: 'not', child: root, range: RANGE }], range: RANGE },
		universe: [],
		eligibility: 'words',
		snapshot: { now: 0, timeZone: 'UTC' }
	};
}

function single(root: QueryNode): ParsedQuery {
	return { root, universe: [], eligibility: 'words', snapshot: { now: 0, timeZone: 'UTC' } };
}

function sqlOf(plan: Plan): string[] {
	const table = (k: number) => `temp.l${k}`;
	const all = (e: Expr) => [render(e, plan, table).sql, knownOf(e, plan).sql];
	return [...all(plan.expr), ...plan.filters.flatMap(all), universeOf(plan).sql];
}

function matchShape(match: string): string {
	return match.replace(/"(?:[^"]|"")*"/g, 'Q');
}

function unquote(segment: string): string {
	return segment.slice(1, -1).replaceAll('""', '"');
}

describe('compiled structure', () => {
	it('quotes FTS strings so every embedded quote is doubled', () => {
		for (const value of HOSTILE) {
			const quoted = quote(value);
			expect(matchShape(quoted)).toBe('Q');
			expect(unquote(quoted)).toBe(value);
		}
	});

	it('keeps SQL and MATCH structure independent of the values', () => {
		const baseline = shapes('zzz').map((node) => {
			const result = compile(parsed(node), ctx('zzz'));
			if (!result.ok) throw new Error(node.kind);
			return result.plan;
		});
		for (const value of HOSTILE) {
			shapes(value).forEach((node, i) => {
				const result = compile(parsed(node), ctx(value));
				if (!result.ok) throw new Error(`${node.kind} ${value}`);
				const plan = result.plan;
				const base = baseline[i];
				expect(sqlOf(plan), `${node.kind} ${value}`).toEqual(sqlOf(base));
				for (const sql of sqlOf(plan)) expect(sql.includes(value), `${node.kind} ${value}`).toBe(false);
				expect(plan.leaves.length).toBe(base.leaves.length);
				plan.leaves.forEach((leaf, k) => {
					expect(leaf.steps.map((s) => s.kind)).toEqual(base.leaves[k].steps.map((s) => s.kind));
					leaf.steps.forEach((step, j) => {
						const other = base.leaves[k].steps[j];
						if (step.kind === 'scan' || other.kind === 'scan') return;
						expect(matchShape(step.match), `${node.kind} ${value}`).toBe(matchShape(other.match));
						const segments = step.match.match(/"(?:[^"]|"")*"/g) ?? [];
						expect(segments.map(unquote).every((s) => s === value || s === `${value} x`)).toBe(true);
					});
				});
			});
		}
	});

	it('uses only the fixed MATCH templates', () => {
		for (const node of shapes('zzz')) {
			const result = compile(parsed(node), ctx('zzz'));
			if (!result.ok) throw new Error(node.kind);
			for (const leaf of result.plan.leaves) {
				for (const step of leaf.steps) {
					if (step.kind === 'scan') continue;
					expect(['Q', 'Q *', 'NEAR(Q Q, 3)']).toContain(matchShape(step.match));
				}
			}
		}
	});

	it('reports unknown folders and labels with their range', () => {
		const empty: QueryContext = { identities: [], folders: [], labels: [], attachmentText: true };
		const range = { start: 3, end: 9 };
		expect(compile(parsed({ kind: 'folder', path: 'Nope', range }), empty)).toEqual({
			ok: false,
			error: { code: 'unknown_folder', range, name: 'Nope' }
		});
		expect(compile(parsed({ kind: 'label', name: 'Nope', range }), empty)).toEqual({
			ok: false,
			error: { code: 'unknown_label', range, name: 'Nope' }
		});
	});

	it('resolves duplicate label names to every match and reports them', () => {
		const c: QueryContext = {
			identities: [],
			folders: [],
			labels: [
				{ id: 'l1', name: 'Tax 2026' },
				{ id: 'l2', name: 'tax 2026' },
				{ id: 'l3', name: 'Tax' }
			],
			attachmentText: true
		};
		const range = { start: 0, end: 16 };
		const out = compile(single({ kind: 'label', name: 'Tax 2026', range }), c);
		if (!out.ok) throw new Error('compile failed');
		expect(out.plan.resolved).toEqual([{ kind: 'label', name: 'Tax 2026', range, ids: ['l1', 'l2'], descendants: 0 }]);
	});

	it('includes subfolders unless exact folders are asked for', () => {
		const c: QueryContext = {
			identities: [],
			folders: [
				{ id: 'p', path: 'Projects' },
				{ id: 'pi', path: 'Projects/Invoices' },
				{ id: 'o', path: 'Other' }
			],
			labels: [],
			attachmentText: true
		};
		const node: QueryNode = { kind: 'folder', path: 'projects', range: RANGE };
		const wide = compile(single(node), c);
		const narrow = compile(single(node), { ...c, exactFolders: true });
		if (!wide.ok || !narrow.ok) throw new Error('compile failed');
		expect(wide.plan.resolved[0]).toMatchObject({ ids: ['p', 'pi'], descendants: 1 });
		expect(narrow.plan.resolved[0]).toMatchObject({ ids: ['p'], descendants: 1 });
	});

	it('collects positive text for highlighting and skips negated text', () => {
		const node: QueryNode = {
			kind: 'and',
			children: [
				{ kind: 'phrase', text: 'hotel invoice', range: RANGE },
				{ kind: 'prefix', text: 'rec', range: RANGE },
				{ kind: 'not', child: { kind: 'term', text: 'spam', lane: 'word', range: RANGE }, range: RANGE }
			],
			range: RANGE
		};
		const out = compile(single(node), ctx('x'));
		if (!out.ok) throw new Error('compile failed');
		expect(out.plan.highlights.map((h) => [h.kind, h.text])).toEqual([
			['words', 'hotel invoice'],
			['prefix', 'rec']
		]);
	});
});
