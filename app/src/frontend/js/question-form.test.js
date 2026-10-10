import { correctAnswerPlaceholder } from './question-form.js'

describe('correctAnswerPlaceholder', () => {
	test('matches the selected type', () => {
		expect(correctAnswerPlaceholder('MULTIPLE_CHOICE')).toBe(
			'Type one of the options above exactly'
		)
		expect(correctAnswerPlaceholder('TRUE_FALSE')).toBe(
			"'true' or 'false'"
		)
		expect(correctAnswerPlaceholder('FILL_BLANK')).toMatch(
			/^Expected answer text/
		)
	})

	test('multiple choice never shows the true/false hint', () => {
		expect(correctAnswerPlaceholder('MULTIPLE_CHOICE')).not.toMatch(
			/true|false/i
		)
	})

	test('editing keeps the type-specific hint', () => {
		expect(
			correctAnswerPlaceholder('TRUE_FALSE', {
				editing: true,
			})
		).toBe("Re-enter the correct answer — 'true' or 'false'")
		expect(
			correctAnswerPlaceholder('MULTIPLE_CHOICE', {
				editing: true,
			})
		).toMatch(/options above/)
	})
})
