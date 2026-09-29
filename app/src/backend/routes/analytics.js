import express from 'express'
import pool from '../utils/db.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Analytics Router] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId)
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	if (!req.user) req.user = req.session.user
	next()
}

async function requireEventAuthor(req, res, next) {
	const allowed = ['SUPER_ADMIN', 'EVENT_AUTHOR']
	const placeholders = allowed.map(() => '?').join(', ')
	const userId = req.session?.user?.user_id || req.user?.user_id
	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[userId, ...allowed]
		)
		if (!rows.length)
			return res.status(403).json({
				error: 'Forbidden — event author role required',
			})
		next()
	} catch (err) {
		return res.status(500).json({ error: err.message })
	}
}

// GET /api/analytics/questions/hard — questions everybody gets wrong
// Query: threshold=0.6 (failure rate), min_attempts=5, limit=20
router.get(
	'/questions/hard',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const threshold = parseFloat(req.query.threshold) || 0.5
		const minAttempts = parseInt(req.query.min_attempts, 10) || 5
		const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
		try {
			// Prefer trivia_attempts which is populated by live submit; fallback to offline queue already counted
			const [rows] = await pool.query(
				`SELECT
				tq.question_id AS id,
				tq.event_id,
				tq.format AS type,
				tq.body AS text,
				e.title AS event_title,
				COUNT(ta.attempt_id) AS attempts,
				SUM(CASE WHEN ta.is_correct = 0 THEN 1 ELSE 0 END) AS wrong,
				ROUND(SUM(CASE WHEN ta.is_correct = 0 THEN 1 ELSE 0 END) / COUNT(ta.attempt_id), 3) AS failure_rate,
				SUM(CASE WHEN ta.is_correct = 1 THEN 1 ELSE 0 END) AS correct
			 FROM trivia_questions tq
			 JOIN events e ON e.event_id = tq.event_id
			 JOIN trivia_attempts ta ON ta.question_id = tq.question_id
			 GROUP BY tq.question_id, tq.event_id, tq.format, tq.body, e.title
			 HAVING attempts >= ? AND failure_rate >= ?
			 ORDER BY failure_rate DESC, attempts DESC
			 LIMIT ?`,
				[minAttempts, threshold, limit]
			)
			// enrich with options for repair UI (without leaking is_correct to player view but author can see)
			for (const q of rows) {
				const [opts] = await pool.query(
					`SELECT option_id, body, is_correct FROM trivia_options WHERE question_id = ?`,
					[q.id]
				)
				q.options = opts
				// convert to numbers
				q.attempts = Number(q.attempts)
				q.wrong = Number(q.wrong)
				q.correct = Number(q.correct)
				q.failure_rate = Number(q.failure_rate)
			}
			res.json(rows)
		} catch (err) {
			res.status(500).json({ error: err.message })
		}
	}
)

// GET /api/analytics/events/stale — old/expired events that should be retired
router.get(
	'/events/stale',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const days = parseInt(req.query.days, 10) || 30
		try {
			const [rows] = await pool.query(
				`SELECT event_id, title, curation_status, is_active, starts_at, ends_at, campaign_id, created_at,
			        DATEDIFF(UTC_TIMESTAMP(), COALESCE(ends_at, created_at)) AS days_since_end
			 FROM events
			 WHERE (ends_at IS NOT NULL AND ends_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY))
			    OR (ends_at IS NULL AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) AND curation_status = 'PUBLISHED')
			 ORDER BY ends_at ASC
			 LIMIT 50`,
				[days, days]
			)
			res.json(rows)
		} catch (err) {
			res.status(500).json({ error: err.message })
		}
	}
)

// ── User Story 10 — engagement view: attempts/visits per event, sortable ──
// Reads existing logs only (trivia_attempts + location_check_log).
// GET /api/analytics/engagement?sort=attempts|unique_players|visits|correct_rate|title|last_activity&order=desc|asc&limit=50
router.get('/engagement', requireAuth, requireEventAuthor, async (req, res) => {
	const sortKeys = {
		attempts: 'attempts',
		unique_players: 'unique_players',
		visits: 'visits',
		correct_rate: 'correct_rate',
		title: 'title',
		last_activity: 'last_activity',
	}
	const sort = sortKeys[req.query.sort] || 'attempts'
	const order =
		String(req.query.order || 'desc').toLowerCase() === 'asc'
			? 'ASC'
			: 'DESC'
	const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
	try {
		const [rows] = await pool.query(
			`SELECT
					e.event_id, e.title, e.latitude, e.longitude,
					e.is_active, e.curation_status,
					COUNT(ta.attempt_id) AS attempts,
					COUNT(DISTINCT ta.user_id) AS unique_players,
					SUM(CASE WHEN ta.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
					CASE WHEN COUNT(ta.attempt_id) = 0 THEN NULL
					     ELSE ROUND(SUM(CASE WHEN ta.is_correct = 1 THEN 1 ELSE 0 END) / COUNT(ta.attempt_id), 3) END AS correct_rate,
					MAX(ta.attempted_at) AS last_activity,
					(SELECT COUNT(*) FROM location_check_log l
					  WHERE l.event_id = e.event_id
					    AND l.status IN ('VERIFIED', 'FALLBACK_QR')) AS visits,
					(SELECT COUNT(DISTINCT l2.user_id) FROM location_check_log l2
					  WHERE l2.event_id = e.event_id
					    AND l2.status IN ('VERIFIED', 'FALLBACK_QR')) AS unique_visitors
				 FROM events e
				 LEFT JOIN trivia_attempts ta ON ta.event_id = e.event_id
				 GROUP BY e.event_id, e.title, e.latitude, e.longitude, e.is_active, e.curation_status
				 ORDER BY ${sort} ${order}, e.event_id ASC
				 LIMIT ?`,
			[limit]
		)
		const out = rows.map((r) => ({
			...r,
			attempts: Number(r.attempts),
			unique_players: Number(r.unique_players),
			correct: Number(r.correct),
			correct_rate:
				r.correct_rate == null
					? null
					: Number(r.correct_rate),
			visits: Number(r.visits),
			unique_visitors: Number(r.unique_visitors),
		}))
		res.json(out)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// ── User Story 10 — question difficulty: correct-rate per question ──
// Reuses the "frequently wrong" aggregation from /questions/hard but returns
// ALL questions with a flag: TOO_HARD (failure ≥ hard_threshold), TOO_EASY
// (correct_rate ≥ easy_threshold), OK otherwise. Zero-attempt questions are
// included as IGNORED so authors see which are never answered.
// GET /api/analytics/questions/difficulty?min_attempts=0&hard=0.6&easy=0.9&flag=all|too_hard|too_easy|ok|ignored&sort=correct_rate|attempts&order=asc&limit=50
router.get(
	'/questions/difficulty',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const minAttempts = Math.max(
			parseInt(req.query.min_attempts, 10) || 0,
			0
		)
		const hardThreshold = parseFloat(req.query.hard) || 0.6
		const easyThreshold = parseFloat(req.query.easy) || 0.9
		const flagFilter = String(req.query.flag || 'all').toLowerCase()
		const sortKeys = {
			correct_rate: 'correct_rate',
			attempts: 'attempts',
			failure_rate: 'failure_rate',
		}
		const sort = sortKeys[req.query.sort] || 'correct_rate'
		const order =
			String(req.query.order || 'asc').toLowerCase() ===
			'desc'
				? 'DESC'
				: 'ASC'
		const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
		try {
			const [rows] = await pool.query(
				`SELECT
					tq.question_id AS id,
					tq.event_id,
					tq.format AS type,
					tq.body AS text,
					e.title AS event_title,
					COUNT(ta.attempt_id) AS attempts,
					SUM(CASE WHEN ta.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
					SUM(CASE WHEN ta.is_correct = 0 THEN 1 ELSE 0 END) AS wrong,
					CASE WHEN COUNT(ta.attempt_id) = 0 THEN NULL
					     ELSE ROUND(SUM(CASE WHEN ta.is_correct = 1 THEN 1 ELSE 0 END) / COUNT(ta.attempt_id), 3) END AS correct_rate,
					CASE WHEN COUNT(ta.attempt_id) = 0 THEN NULL
					     ELSE ROUND(SUM(CASE WHEN ta.is_correct = 0 THEN 1 ELSE 0 END) / COUNT(ta.attempt_id), 3) END AS failure_rate
				 FROM trivia_questions tq
				 JOIN events e ON e.event_id = tq.event_id
				 LEFT JOIN trivia_attempts ta ON ta.question_id = tq.question_id
				 GROUP BY tq.question_id, tq.event_id, tq.format, tq.body, e.title
				 HAVING attempts >= ?
				 ORDER BY ${sort} ${order}, attempts DESC
				 LIMIT ?`,
				[minAttempts, limit]
			)
			let out = rows.map((r) => {
				const attempts = Number(r.attempts)
				const correct = Number(r.correct)
				const wrong = Number(r.wrong)
				const correct_rate =
					r.correct_rate == null
						? null
						: Number(r.correct_rate)
				const failure_rate =
					r.failure_rate == null
						? null
						: Number(r.failure_rate)
				let flag = 'OK'
				if (attempts === 0) flag = 'IGNORED'
				else if (failure_rate >= hardThreshold)
					flag = 'TOO_HARD'
				else if (correct_rate >= easyThreshold)
					flag = 'TOO_EASY'
				return {
					id: r.id,
					event_id: r.event_id,
					type: r.type,
					text: r.text,
					event_title: r.event_title,
					attempts,
					correct,
					wrong,
					correct_rate,
					failure_rate,
					flag,
				}
			})
			if (
				[
					'too_hard',
					'too_easy',
					'ok',
					'ignored',
				].includes(flagFilter)
			) {
				const want = flagFilter.toUpperCase()
				out = out.filter((q) => q.flag === want)
			}
			res.json(out)
		} catch (err) {
			res.status(500).json({ error: err.message })
		}
	}
)

// ── User Story 10 — card drop-rate view: actual issuance vs configured ──
// Reads existing logs only (event_card_awards ledger + event_card_pool config).
// GET /api/analytics/cards/drop-rates?event_id=&limit=100
router.get(
	'/cards/drop-rates',
	requireAuth,
	requireEventAuthor,
	async (req, res) => {
		const limit = Math.min(
			parseInt(req.query.limit, 10) || 100,
			500
		)
		const eventId =
			req.query.event_id != null && req.query.event_id !== ''
				? parseInt(req.query.event_id, 10)
				: null
		if (
			req.query.event_id != null &&
			req.query.event_id !== '' &&
			!Number.isInteger(eventId)
		)
			return res
				.status(400)
				.json({ error: 'event_id must be an integer' })
		try {
			const awardFilter =
				eventId != null ? 'WHERE eca.event_id = ?' : ''
			const awardParams = eventId != null ? [eventId] : []
			const [totalRows] = await pool.query(
				`SELECT COUNT(*) AS total FROM event_card_awards eca ${awardFilter}`,
				awardParams
			)
			const total = Number(totalRows[0]?.total || 0)
			const poolFilter =
				eventId != null ? 'WHERE p.event_id = ?' : ''
			const [weightRows] = await pool.query(
				`SELECT COALESCE(SUM(p.weight), 0) AS total_weight FROM event_card_pool p ${poolFilter}`,
				awardParams
			)
			const totalWeight = Number(
				weightRows[0]?.total_weight || 0
			)
			const [rows] = await pool.query(
				`SELECT
					c.card_id, c.name, c.rarity, c.category,
					COALESCE(SUM(p.weight), 0) AS configured_weight,
					COALESCE(MAX(p.global_copy_limit), NULL) AS sample_copy_limit,
					COALESCE(SUM(p.copies_awarded), 0) AS pool_copies_awarded,
					COUNT(eca.award_id) AS times_awarded
				 FROM cards c
				 LEFT JOIN event_card_pool p ON p.card_id = c.card_id ${eventId != null ? 'AND p.event_id = ?' : ''}
				 LEFT JOIN event_card_awards eca ON eca.card_id = c.card_id ${eventId != null ? 'AND eca.event_id = ?' : ''}
				 GROUP BY c.card_id, c.name, c.rarity, c.category
				 ORDER BY times_awarded DESC, c.card_id ASC
				 LIMIT ?`,
				eventId != null
					? [eventId, eventId, limit]
					: [limit]
			)
			const out = rows.map((r) => {
				const times_awarded = Number(r.times_awarded)
				const configured_weight = Number(
					r.configured_weight
				)
				return {
					card_id: r.card_id,
					name: r.name,
					rarity: r.rarity,
					category: r.category,
					times_awarded,
					actual_rate:
						total === 0
							? 0
							: Number(
									(
										times_awarded /
										total
									).toFixed(
										4
									)
								),
					configured_weight,
					expected_rate:
						totalWeight === 0
							? null
							: Number(
									(
										configured_weight /
										totalWeight
									).toFixed(
										4
									)
								),
					sample_copy_limit: r.sample_copy_limit,
					pool_copies_awarded: Number(
						r.pool_copies_awarded
					),
					total_awards: total,
					drift:
						totalWeight === 0 || total === 0
							? null
							: Number(
									(
										times_awarded /
											total -
										configured_weight /
											totalWeight
									).toFixed(
										4
									)
								),
				}
			})
			res.json({
				total_awards: total,
				total_weight: totalWeight,
				event_id: eventId,
				cards: out,
			})
		} catch (err) {
			res.status(500).json({ error: err.message })
		}
	}
)

// GET /api/analytics/overview — counts per status for dashboard
router.get('/overview', requireAuth, requireEventAuthor, async (req, res) => {
	try {
		const [statusCounts] = await pool.query(
			`SELECT curation_status AS status, COUNT(*) AS count FROM events GROUP BY curation_status`
		)
		const [campaignCounts] = await pool.query(
			`SELECT status, COUNT(*) AS count FROM campaigns GROUP BY status`
		)
		const [hardCount] = await pool.query(
			`SELECT COUNT(*) AS hard_questions FROM (
				SELECT tq.question_id FROM trivia_questions tq JOIN trivia_attempts ta ON ta.question_id = tq.question_id
				GROUP BY tq.question_id HAVING COUNT(*) >= 5 AND SUM(CASE WHEN ta.is_correct=0 THEN 1 ELSE 0 END)/COUNT(*) >= 0.5
			) x`
		)
		const [staleCount] = await pool.query(
			`SELECT COUNT(*) AS stale FROM events WHERE ends_at IS NOT NULL AND ends_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND curation_status != 'RETIRED'`
		)
		// Extra rollups for the Story-10 dashboard (best-effort; null on old DBs)
		let easyQuestions = null
		let totalAttempts = null
		let totalAwards = null
		try {
			const [easy] = await pool.query(
				`SELECT COUNT(*) AS easy_questions FROM (
					SELECT tq.question_id FROM trivia_questions tq JOIN trivia_attempts ta ON ta.question_id = tq.question_id
					GROUP BY tq.question_id HAVING COUNT(*) >= 5 AND SUM(CASE WHEN ta.is_correct=1 THEN 1 ELSE 0 END)/COUNT(*) >= 0.9
				) x`
			)
			easyQuestions = easy[0].easy_questions
		} catch {}
		try {
			const [att] = await pool.query(
				`SELECT COUNT(*) AS total_attempts, COUNT(DISTINCT event_id) AS active_events FROM trivia_attempts`
			)
			totalAttempts = att[0].total_attempts
		} catch {}
		try {
			const [aw] = await pool.query(
				`SELECT COUNT(*) AS total_awards FROM event_card_awards`
			)
			totalAwards = aw[0].total_awards
		} catch {}
		res.json({
			statusCounts,
			campaignCounts,
			hard_questions: hardCount[0].hard_questions,
			stale_events: staleCount[0].stale,
			easy_questions: easyQuestions,
			total_attempts: totalAttempts,
			total_awards: totalAwards,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
