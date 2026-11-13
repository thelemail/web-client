export interface Range {
	start: number;
	end: number;
}

export type TextLane = 'word' | 'identifier';
export type TextField = 'subject' | 'body' | 'attachment';
export type ParticipantRole = 'from' | 'to' | 'cc' | 'bcc';
export type SystemScope =
	| 'inbox'
	| 'sent'
	| 'archive'
	| 'snoozed'
	| 'drafts'
	| 'scheduled'
	| 'spam'
	| 'trash'
	| 'anywhere';
export type HasValue =
	| 'attachment'
	| 'document'
	| 'spreadsheet'
	| 'presentation'
	| 'image'
	| 'userlabels'
	| 'nouserlabels';
export type StateValue = 'read' | 'unread' | 'starred';
export type WidenedScope = 'spam' | 'trash';
export type Eligibility = 'words' | 'meaning' | 'related';

export type ParticipantValue =
	| { kind: 'me' }
	| { kind: 'address'; address: string }
	| { kind: 'name'; text: string; prefix: boolean };

export type TermNode = { kind: 'term'; text: string; lane: TextLane; range: Range };
export type PhraseNode = { kind: 'phrase'; text: string; range: Range };
export type ProximityOperand = TermNode | PhraseNode;

export type QueryNode =
	| { kind: 'and'; children: QueryNode[]; range: Range }
	| { kind: 'or'; children: QueryNode[]; range: Range }
	| { kind: 'not'; child: QueryNode; range: Range }
	| {
			kind: 'around';
			left: ProximityOperand;
			right: ProximityOperand;
			distance: number;
			range: Range;
	  }
	| TermNode
	| PhraseNode
	| { kind: 'literal'; text: string; lane: TextLane; range: Range }
	| { kind: 'prefix'; text: string; range: Range }
	| { kind: 'field'; field: TextField; child: QueryNode; range: Range }
	| { kind: 'participant'; role: ParticipantRole; value: ParticipantValue; range: Range }
	| { kind: 'filename'; text: string; range: Range }
	| { kind: 'filetype'; text: string; range: Range }
	| { kind: 'has'; value: HasValue; range: Range }
	| { kind: 'scope'; scope: SystemScope; range: Range }
	| { kind: 'folder'; path: string; range: Range }
	| { kind: 'label'; name: string; range: Range }
	| { kind: 'state'; state: StateValue; range: Range }
	| { kind: 'date'; bound: 'after' | 'before'; at: number; range: Range }
	| { kind: 'size'; op: 'gt' | 'lt'; bytes: number; range: Range }
	| { kind: 'deliveredto'; address: string; range: Range }
	| { kind: 'list'; value: string; range: Range }
	| { kind: 'msgid'; id: string; range: Range };

export type QueryNodeKind = QueryNode['kind'];

export type QueryErrorCode =
	| 'too_long'
	| 'too_many_nodes'
	| 'too_deep'
	| 'unterminated_quote'
	| 'unbalanced_paren'
	| 'empty_group'
	| 'empty_phrase'
	| 'dangling_operator'
	| 'unsupported_filter'
	| 'gmail_only'
	| 'missing_value'
	| 'invalid_value'
	| 'invalid_date'
	| 'invalid_size'
	| 'invalid_relative'
	| 'invalid_wildcard'
	| 'prefix_too_short'
	| 'around_distance'
	| 'around_operand'
	| 'literal_operand'
	| 'nested_scope'
	| 'unavailable'
	| 'unknown_folder'
	| 'unknown_label';

export interface QueryError {
	code: QueryErrorCode;
	range: Range;
	name?: string;
	hint?: string;
}

export interface QuerySnapshot {
	now: number;
	timeZone: string;
}

export interface ParsedQuery {
	root: QueryNode | null;
	universe: WidenedScope[];
	eligibility: Eligibility;
	snapshot: QuerySnapshot;
}

export type ParseResult = { ok: true; query: ParsedQuery } | { ok: false; error: QueryError };

export const LIMITS = {
	bytes: 4096,
	nodes: 128,
	depth: 16,
	distance: 1000
} as const;

export class QuerySyntaxError extends Error {
	readonly error: QueryError;

	constructor(error: QueryError) {
		super(error.code);
		this.error = error;
	}
}

export function fail(code: QueryErrorCode, range: Range, extra: Partial<QueryError> = {}): never {
	throw new QuerySyntaxError({ code, range, ...extra });
}
