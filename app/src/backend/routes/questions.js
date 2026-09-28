import express from 'express'
import pool from '../utils/db.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Questions Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId) {
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	}
	if (!req.user) req.user = req.session.user
	next()
}

async function requireEventAuthor(req, res, next) {
	const allowedRoles = ['SUPER_ADMIN', 'EVENT_AUTHOR']
	const placeholders = allowedRoles.map(() => '?').join(', ')
	const userId = req.session?.user?.user_id || req.user?.user_id

	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[userId, ...allowedRoles]
		)
		if (!rows.length) {
			return res.status(403).json({
				error: 'Forbidden — event author role required',
			})
		}
		next()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
}

const QUESTION_FORMATS = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK']

function validateQuestion({ type, text, correctAnswer, options }) {
	if (!QUESTION_FORMATS.includes(type)) {
		return `type must be one of ${QUESTION_FORMATS.join(', ')}`
	}
	if (!text || !String(text).trim()) {
		return 'text is required'
	}
	if (correctAnswer == null || !String(correctAnswer).trim()) {
		return 'correctAnswer is required'
	}
	if (type === 'MULTIPLE_CHOICE') {
		if (!Array.isArray(options) || options.length === 0) {
			return 'options must be a non-empty array for MULTIPLE_CHOICE'
		}
		if (
			!options.some(
				(opt) => String(opt) === String(correctAnswer)
			)
		) {
			return 'correctAnswer must be one of the provided options'
		}
	}
	if (type === 'TRUE_FALSE') {
		const ca = String(correctAnswer).toLowerCase()
		if (ca !== 'true' && ca !== 'false') {
			return 'correctAnswer must be "true" or "false" for TRUE_FALSE'
		}
	}
	return null
}

/**
 * GET /events/:eventId/questions
 * Lists questions for an event. Omits correct answer — reads from
 * trivia_questions + trivia_options (no is_correct exposed to client).
 */
router.get('/events/:eventId/questions', async (req, res) => {
	try {
		const [questions] = await pool.query(
			`SELECT question_id AS id, event_id, format AS type, body AS text,
			        time_limit_s, difficulty, question_id AS created_at
			 FROM trivia_questions
			 WHERE event_id = ?
			 ORDER BY question_id ASC`,
			[req.params.eventId]
		)

		// Attach options for each question (without is_correct). A
		// FILL_BLANK question's only "option" IS its answer, so it's never
		// sent — this route is public.
		for (const q of questions) {
			if (q.type === 'FILL_BLANK') {
				q.options = null
				continue
			}
			const [options] = await pool.query(
				`SELECT option_id, body FROM trivia_options WHERE question_id = ?`,
				[q.id]
			)
			// Return options as a plain array of strings for MULTIPLE_CHOICE
			// to match what the console form expects
			q.options = options.length
				? options.map((o) => o.body)
				: null
		}

		res.json(questions)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /events/:eventId/questions
 * Creates a question with options in trivia_questions + trivia_options.
 */
router.post(
	'/events/:eventId/questions',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const { type, text, correctAnswer, options } = req.body

		const validationError = validateQuestion({
			type,
			text,
			correctAnswer,
			options,
		})
		if (validationError) {
			return res.status(400).json({ error: validationError })
		}

		// Confirm event exists
		const [events] = await pool.query(
			'SELECT event_id FROM events WHERE event_id = ?',
			[req.params.eventId]
		)
		if (!events.length) {
			return res
				.status(404)
				.json({ error: 'Event not found' })
		}

		const conn = await pool.getConnection()
		try {
			await conn.beginTransaction()

			// Insert into trivia_questions
			const [result] = await conn.query(
				`INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
				 VALUES (?, ?, ?, 30, 1)`,
				[req.params.eventId, type, text]
			)
			const questionId = result.insertId

			// Insert options into trivia_options
			if (
				type === 'MULTIPLE_CHOICE' &&
				Array.isArray(options)
			) {
				for (const opt of options) {
					const isCorrect =
						String(opt) ===
						String(correctAnswer)
					await conn.query(
						`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
						[questionId, opt, isCorrect]
					)
				}
			} else if (type === 'TRUE_FALSE') {
				const ca = String(correctAnswer).toLowerCase()
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
					[questionId, 'True', ca === 'true']
				)
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
					[questionId, 'False', ca === 'false']
				)
			} else if (type === 'FILL_BLANK') {
				// Store the correct answer as the only option
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, TRUE)`,
					[questionId, correctAnswer]
				)
			}

			await conn.commit()
			res.status(201).json({
				message: 'Question created',
				id: questionId,
			})
		} catch (err) {
			await conn.rollback()
			res.status(500).json({ error: err.message })
		} finally {
			conn.release()
		}
	}
)

/**
 * PUT /questions/:id
 * Updates a question — deletes old options and reinserts.
 */
router.put(
	'/questions/:id',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const { type, text, correctAnswer, options } = req.body

		const validationError = validateQuestion({
			type,
			text,
			correctAnswer,
			options,
		})
		if (validationError) {
			return res.status(400).json({ error: validationError })
		}

		const [existing] = await pool.query(
			'SELECT question_id FROM trivia_questions WHERE question_id = ?',
			[req.params.id]
		)
		if (!existing.length) {
			return res
				.status(404)
				.json({ error: 'Question not found' })
		}

		const conn = await pool.getConnection()
		try {
			await conn.beginTransaction()

			// Update the question body
			await conn.query(
				`UPDATE trivia_questions SET format = ?, body = ? WHERE question_id = ?`,
				[type, text, req.params.id]
			)

			// Delete old options and reinsert
			await conn.query(
				'DELETE FROM trivia_options WHERE question_id = ?',
				[req.params.id]
			)

			if (
				type === 'MULTIPLE_CHOICE' &&
				Array.isArray(options)
			) {
				for (const opt of options) {
					const isCorrect =
						String(opt) ===
						String(correctAnswer)
					await conn.query(
						`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
						[req.params.id, opt, isCorrect]
					)
				}
			} else if (type === 'TRUE_FALSE') {
				const ca = String(correctAnswer).toLowerCase()
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
					[req.params.id, 'True', ca === 'true']
				)
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
					[req.params.id, 'False', ca === 'false']
				)
			} else if (type === 'FILL_BLANK') {
				await conn.query(
					`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, TRUE)`,
					[req.params.id, correctAnswer]
				)
			}

			await conn.commit()
			res.json({ message: 'Question updated' })
		} catch (err) {
			await conn.rollback()
			res.status(500).json({ error: err.message })
		} finally {
			conn.release()
		}
	}
)

/**
 * DELETE /questions/:id
 * Deletes a question and its options in one transaction. There is no FK
 * cascade on trivia_options, so the options go first. A question players
 * have already answered is kept (409): trivia_attempts and
 * offline_trivia_queue reference it, and that history backs points and
 * card awards.
 */
router.delete(
	'/questions/:id',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const conn = await pool.getConnection()
		try {
			await conn.beginTransaction()

			const [existing] = await conn.query(
				'SELECT question_id FROM trivia_questions WHERE question_id = ? FOR UPDATE',
				[req.params.id]
			)
			if (!existing.length) {
				await conn.rollback()
				return res
					.status(404)
					.json({ error: 'Question not found' })
			}

			const [[{ answered }]] = await conn.query(
				`SELECT (SELECT COUNT(*) FROM trivia_attempts WHERE question_id = ?)
				      + (SELECT COUNT(*) FROM offline_trivia_queue WHERE question_id = ?) AS answered`,
				[req.params.id, req.params.id]
			)
			if (Number(answered) > 0) {
				await conn.rollback()
				return res.status(409).json({
					error: 'Players have already answered this question, so it can’t be deleted (their attempt history depends on it). Edit it instead.',
				})
			}

			await conn.query(
				'DELETE FROM trivia_options WHERE question_id = ?',
				[req.params.id]
			)
			await conn.query(
				'DELETE FROM trivia_questions WHERE question_id = ?',
				[req.params.id]
			)
			await conn.commit()
			res.json({ message: 'Question deleted' })
		} catch (err) {
			await conn.rollback()
			res.status(500).json({ error: err.message })
		} finally {
			conn.release()
		}
	}
)

export default router
