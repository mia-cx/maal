import { McpKeyAuthRequired, McpKeyRequestFailed } from '$lib/client/mcp-keys.js';
import * as m from '$lib/paraglide/messages';

/** Translated messages for the error codes the MCP key routes return. */
const MESSAGE_BY_CODE: Readonly<Record<string, () => string>> = {
	household_forbidden: m.settings_you_can_only_scope_mcp_keys_to_your_househol,
	household_required: m.settings_choose_at_least_one_household,
	not_found: m.settings_mcp_key_not_found,
	mcp_key_storage_unavailable: m.settings_mcp_key_storage_is_not_available,
	McpKeyLimitError: m.settings_mcp_key_limit_reached,
	no_remote_service: m.settings_mcp_keys_need_active_subscription
};

/**
 * Explains a failed MCP key request in the user's language. Known server codes get a specific
 * message; anything else gets `fallback`, the message for the action that failed.
 */
export const mcpKeyErrorMessage = (cause: unknown, fallback: () => string): string => {
	if (cause instanceof McpKeyAuthRequired) return m.settings_mcp_keys_sign_in_again();
	if (cause instanceof McpKeyRequestFailed)
		return (MESSAGE_BY_CODE[cause.safeMessage] ?? fallback)();
	return fallback();
};

/** Checks a key label against the route's 2 to 80 character limit before sending it. */
export const mcpKeyLabelError = (label: string): string | null => {
	const length = label.trim().length;
	if (length < 2) return m.settings_give_this_mcp_key_a_label();
	if (length > 80) return m.settings_keep_the_mcp_key_label_under_80_characters();
	return null;
};
