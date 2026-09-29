/**
 * Placeholder for the question form's Correct Answer field, matching the
 * selected question type (console.js). editing: the list endpoint never
 * returns answers, so an edited question's answer is re-entered.
 */
export function correctAnswerPlaceholder(type, { editing = false } = {}) {
	const hint =
		type === 'TRUE_FALSE'
			? "'true' or 'false'"
			: type === 'FILL_BLANK'
				? 'Expected answer text (case and spacing ignored)'
				: 'Type one of the options above exactly'
	return editing ? `Re-enter the correct answer — ${hint}` : hint
}
