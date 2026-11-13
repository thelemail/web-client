import { m } from '$paraglide/messages.js';
import type { QueryError } from './ast';

export function queryErrorMessage(error: QueryError): string {
	const name = error.name ?? '';
	const hint = error.hint;
	switch (error.code) {
		case 'too_long':
			return m.search_query_error_too_long();
		case 'too_many_nodes':
			return m.search_query_error_too_many_nodes();
		case 'too_deep':
			return m.search_query_error_too_deep();
		case 'unterminated_quote':
			return m.search_query_error_unterminated_quote();
		case 'unbalanced_paren':
			return m.search_query_error_unbalanced_paren();
		case 'empty_group':
			return m.search_query_error_empty_group();
		case 'empty_phrase':
			return m.search_query_error_empty_phrase();
		case 'dangling_operator':
			return m.search_query_error_dangling_operator();
		case 'unsupported_filter':
			return hint
				? m.search_query_error_unsupported_filter_hint({ name, hint })
				: m.search_query_error_unsupported_filter({ name });
		case 'gmail_only':
			return hint
				? m.search_query_error_gmail_only_hint({ name, hint })
				: m.search_query_error_gmail_only({ name });
		case 'missing_value':
			return m.search_query_error_missing_value({ name });
		case 'invalid_value':
			return m.search_query_error_invalid_value({ name });
		case 'invalid_date':
			return m.search_query_error_invalid_date({ name });
		case 'invalid_relative':
			return m.search_query_error_invalid_relative({ name });
		case 'invalid_size':
			return m.search_query_error_invalid_size({ name });
		case 'invalid_wildcard':
			return m.search_query_error_invalid_wildcard();
		case 'prefix_too_short':
			return m.search_query_error_prefix_too_short();
		case 'around_distance':
			return m.search_query_error_around_distance();
		case 'around_operand':
			return m.search_query_error_around_operand();
		case 'literal_operand':
			return m.search_query_error_literal_operand();
		case 'nested_scope':
			return m.search_query_error_nested_scope();
		case 'unavailable':
			return m.search_query_error_unavailable();
		case 'unknown_folder':
			return m.search_query_error_unknown_folder({ name });
		case 'unknown_label':
			return m.search_query_error_unknown_label({ name });
	}
}
