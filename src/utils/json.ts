/**
 * Helpers for parsing JSON out of LLM responses, which often wrap the payload in a
 * Markdown code fence and can be truncated when the model hits its `max_tokens`.
 */

/**
 * Strip a Markdown code fence from an LLM response so the inner JSON can be parsed.
 *
 * Handles three shapes:
 * - a fully fenced block: ```` ```json\n{...}\n``` ```` → the inner text
 * - an opening fence whose closing ```` ``` ```` is missing (a truncated response,
 *   the cause of `Unexpected token '` '` parse failures) → the text after the opener
 * - unfenced text → returned trimmed, unchanged
 *
 * Returns the trimmed inner text; the caller still parses and handles parse failure.
 */
export function stripCodeFence(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenced) return fenced[1].trim();
	// Opening fence with no closing fence (e.g. the response was cut off mid-JSON).
	if (/^```/.test(trimmed)) {
		return trimmed.replace(/^```(?:json)?\s*/i, '').trim();
	}
	return trimmed;
}
