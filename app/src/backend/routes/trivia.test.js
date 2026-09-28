import { jest } from '@jest/globals'

// Mock the shared pool BEFORE the router imports it. The route calls
// pool.query() for reads and pool.getConnection() for the atomic submit
// transaction. This mock covers both.
jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
		getConnection: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { default: trivia_router } = await import('./trivia.js')

import express from 'express'
import { createServer } from 'http'

// ── Test harness ────────────────────────────────────────────
// Mounts the trivia router on a bare Express app with a fake session,
// starts an HTTP listener on an ephemeral port, and drives it with
// fetch. Mirrors the pattern in leaderboard.test.js and sync.test.js.
//
// NOTE: the router stashes `req.session.trivia_issue` when the GET
// route is called, so the same session object must survive between
// requests in a test. That is what the shared sessionMut object below
// gives us.

function makeApp(sessionUser = { user_id: 1 }) {
	const session = sessionUser ? { user: sessionUser } : {}
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = session
		next()
	})
	app.use('/api/trivia', trivia_router)
	return app
}

async function withServer(app, fn) {
	const server = createServer(app)
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()
	try {
		await fn(`http://127.0.0.1:${port}`)
	} finally {
		await new Promise((resolve) => server.close(resolve))
	}
}

// Build a fake transaction connection for the /submit route. Records
// which side-effecting queries fired so tests can assert on them.
function makeConn(opts = {}) {
	const calls = {
		locationCheckInsert: 0,
		attemptInsert: 0,
		userPointsUpdate: 0,
		pointTransactionInsert: 0,
		commits: 0,
		rollbacks: 0,
	}
	const conn = {
		calls,
		beginTransaction: jest.fn(async () => {}),
		commit: jest.fn(async () => {
			calls.commits++
		}),
		rollback: jest.fn(async () => {
			calls.rollbacks++
		}),
		release: jest.fn(),
		query: jest.fn(async (sql) => {
			const q = String(sql)
				.trim()
				.toLowerCase()
				.replace(/\s+/g, ' ')

			if (q.startsWith('insert into location_check_log')) {
				calls.locationCheckInsert++
				return [{ insertId: 999, affectedRows: 1 }]
			}
			if (q.startsWith('insert into trivia_attempts')) {
				calls.attemptInsert++
				return [{ insertId: 1000, affectedRows: 1 }]
			}
			if (q.startsWith('update users set points')) {
				calls.userPointsUpdate++
				return [{ affectedRows: 1 }]
			}
			if (q.startsWith('insert into point_transactions')) {
				calls.pointTransactionInsert++
				return [{ insertId: 1, affectedRows: 1 }]
			}
			if (q.startsWith('insert into event_card_awards')) {
				// Only reached if awardCardIfEligible decides to award.
				return [{ insertId: 1, affectedRows: 1 }]
			}
			if (q.startsWith('insert into user_cards')) {
				return [{ affectedRows: 1 }]
			}
			if (q.startsWith('update event_card_pool')) {
				return [{ affectedRows: 1 }]
			}
			return [[]]
		}),
	}
	return conn
}

// A sample event row as getEventLocation would return it.
function sampleEvent(overrides = {}) {
	return {
		latitude: -26.1905,
		longitude: 28.0285,
		radius_meters: 100,
		point_reward: 20,
		...overrides,
	}
}

// ── GET /api/trivia/event/:eventId ──────────────────────────

describe('GET /api/trivia/event/:eventId', () => {
	beforeEach(() => pool.query.mockReset())

	test('401s when there is no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/1?lat=-26.1905&lng=28.0285`
			)
			expect(res.status).toBe(401)
		})
		expect(pool.query).not.toHaveBeenCalled()
	})

	test('404s when the event does not exist', async () => {
		pool.query.mockResolvedValueOnce([[]]) // getEventLocation: no rows

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/999?lat=-26.1905&lng=28.0285`
			)
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.error).toMatch(/Event not found/i)
		})
	})

	test('403s when the player is outside the event radius', async () => {
		// Event at Wits, player claims to be ~1.1 km north — well outside 100 m.
		pool.query.mockResolvedValueOnce([
			[sampleEvent({ radius_meters: 100 })],
		])

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/1?lat=-26.2&lng=28.0285`
			)
			expect(res.status).toBe(403)
			const body = await res.json()
			expect(body.error).toMatch(/too far/i)
			expect(body.distance_meters).toBeGreaterThan(100)
			expect(body.radius_meters).toBe(100)
		})
	})

	test('404s when the event has no questions configured', async () => {
		pool.query
			.mockResolvedValueOnce([[sampleEvent()]]) // event
			.mockResolvedValueOnce([[]]) // question query: no rows

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/1?lat=-26.1905&lng=28.0285`
			)
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.error).toMatch(
				/No active trivia questions/i
			)
		})
	})

	test('200 — returns question + options WITHOUT is_correct', async () => {
		pool.query
			.mockResolvedValueOnce([[sampleEvent()]]) // event
			.mockResolvedValueOnce([
				[
					{
						question_id: 42,
						format: 'MULTIPLE_CHOICE',
						body: 'Who founded Wits?',
						time_limit_s: 30,
						difficulty: 1,
					},
				],
			]) // question
			.mockResolvedValueOnce([
				[
					{ option_id: 1, body: 'Answer A' },
					{ option_id: 2, body: 'Answer B' },
					{ option_id: 3, body: 'Answer C' },
				],
			]) // options
			.mockResolvedValueOnce([[]]) // canAwardCard: prior win check
			.mockResolvedValueOnce([[{ check_id: null }]]) // (unused, defensive)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/1?lat=-26.1905&lng=28.0285`
			)
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.question_id).toBe(42)
			expect(body.body).toBe('Who founded Wits?')
			expect(body.options).toHaveLength(3)

			// The whole security story: is_correct must NEVER appear in
			// the GET response.
			for (const opt of body.options) {
				expect(opt).not.toHaveProperty('is_correct')
			}
			const rawBody = JSON.stringify(body)
			expect(rawBody).not.toContain('is_correct')
		})
	})

	test('200 — fallback_required when GPS accuracy is too poor', async () => {
		pool.query.mockResolvedValueOnce([[sampleEvent()]]) // event

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trivia/event/1?lat=-26.1905&lng=28.0285&accuracy=75`
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.fallback_required).toBe(true)
			expect(body.threshold_m).toBe(50)
			expect(body.reported_accuracy_m).toBe(75)
		})
	})
})

// ── POST /api/trivia/submit ─────────────────────────────────

describe('POST /api/trivia/submit', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})

	test('401s when there is no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question_id: 1,
					selected_option_id: 1,
				}),
			})
			expect(res.status).toBe(401)
		})
	})

	test('400s when question_id is missing', async () => {
		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ selected_option_id: 1 }),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(/question_id is required/i)
		})
	})

	test('400s when selected_option_id is missing and not a timeout', async () => {
		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question_id: 1 }),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(
				/selected_option_id is required/i
			)
		})
	})

	test('404s when the question does not exist', async () => {
		pool.query.mockResolvedValueOnce([[]]) // question lookup: no rows

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question_id: 999,
					selected_option_id: 1,
					event_id: 1,
				}),
			})
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.error).toMatch(/Unknown question_id/i)
		})
	})

	test('404s when the option does not belong to the question', async () => {
		pool.query
			.mockResolvedValueOnce([[{ time_limit_s: 30 }]]) // question
			.mockResolvedValueOnce([[]]) // option lookup: no rows

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question_id: 42,
					selected_option_id: 9999,
					event_id: 1,
				}),
			})
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.error).toMatch(/Invalid option/i)
		})
	})

	test('200 — correct answer: is_correct true, correct_option_text present, points > 0', async () => {
		pool.query
			.mockResolvedValueOnce([[{ time_limit_s: 30 }]]) // question
			.mockResolvedValueOnce([[{ is_correct: 1 }]]) // option: correct
			.mockResolvedValueOnce([
				[{ option_id: 2, body: 'Pretoria' }],
			]) // the correct option
			.mockResolvedValueOnce([
				[sampleEvent({ point_reward: 20 })],
			]) // event
			.mockResolvedValueOnce([[]]) // canAwardCard (via awardCardIfEligible)

		const conn = makeConn()
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					event_id: 1,
					question_id: 42,
					selected_option_id: 2,
					answer_time_ms: 1000,
					claimed_lat: -26.1905,
					claimed_lng: 28.0285,
				}),
			})
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.success).toBe(true)
			expect(body.is_correct).toBe(true)
			expect(body.points_awarded).toBeGreaterThan(0)
			// User story 7 — correct answer surfaced regardless of result.
			expect(body.correct_option_text).toBe('Pretoria')
			expect(body.correct_option_id).toBe(2)
		})

		// Attempt was logged, points ledger updated.
		expect(conn.calls.attemptInsert).toBe(1)
		expect(conn.calls.userPointsUpdate).toBe(1)
		expect(conn.calls.pointTransactionInsert).toBe(1)
		expect(conn.calls.commits).toBeGreaterThan(0)
	})

	test('200 — wrong answer: correct_option_text STILL returned (user story 7)', async () => {
		pool.query
			.mockResolvedValueOnce([[{ time_limit_s: 30 }]])
			.mockResolvedValueOnce([[{ is_correct: 0 }]]) // wrong pick
			.mockResolvedValueOnce([
				[{ option_id: 2, body: 'Pretoria' }],
			]) // the correct one
			.mockResolvedValueOnce([[sampleEvent()]]) // event

		const conn = makeConn()
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					event_id: 1,
					question_id: 42,
					selected_option_id: 1,
					answer_time_ms: 2000,
					claimed_lat: -26.1905,
					claimed_lng: 28.0285,
				}),
			})
			const body = await res.json()

			expect(body.is_correct).toBe(false)
			expect(body.points_awarded).toBe(0)
			// The key assertion: even when wrong, the correct answer is
			// shown back.
			expect(body.correct_option_text).toBe('Pretoria')
		})

		// No points credited for a wrong answer.
		expect(conn.calls.userPointsUpdate).toBe(0)
		expect(conn.calls.pointTransactionInsert).toBe(0)
	})

	test('200 — timed out: is_correct false, correct_option_text still returned', async () => {
		pool.query
			.mockResolvedValueOnce([[{ time_limit_s: 30 }]])
			// No option lookup — timed out submissions don't carry a selection.
			.mockResolvedValueOnce([
				[{ option_id: 2, body: 'Pretoria' }],
			])
			.mockResolvedValueOnce([[sampleEvent()]])

		const conn = makeConn()
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					event_id: 1,
					question_id: 42,
					timed_out: true,
					answer_time_ms: 30000,
					claimed_lat: -26.1905,
					claimed_lng: 28.0285,
				}),
			})
			const body = await res.json()

			expect(body.timed_out).toBe(true)
			expect(body.is_correct).toBe(false)
			expect(body.points_awarded).toBe(0)
			expect(body.correct_option_text).toBe('Pretoria')
		})
	})

	test('200 — replay of a completed event: correct but 0 points (practice only)', async () => {
		pool.query
			.mockResolvedValueOnce([[{ time_limit_s: 30 }]]) // question
			.mockResolvedValueOnce([[{ is_correct: 1 }]]) // option: correct
			.mockResolvedValueOnce([
				[{ option_id: 2, body: 'Pretoria' }],
			]) // the correct option
			.mockResolvedValueOnce([
				[sampleEvent({ point_reward: 20 })],
			]) // event
			.mockResolvedValueOnce([[]]) // canAwardCard (via awardCardIfEligible)

		const conn = makeConn()
		// Prior counted win on this event.
		const baseImpl = conn.query.getMockImplementation()
		conn.query.mockImplementation(async (sql, params) => {
			if (String(sql).toLowerCase().includes('had_prior_win'))
				return [[{ had_prior_win: 1 }]]
			return baseImpl(sql, params)
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trivia/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					event_id: 1,
					question_id: 42,
					selected_option_id: 2,
					answer_time_ms: 1000,
					claimed_lat: -26.1905,
					claimed_lng: 28.0285,
				}),
			})
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.is_correct).toBe(true)
			expect(body.points_awarded).toBe(0)
			expect(body.already_completed).toBe(true)
			expect(body.message).toMatch(/already completed/i)
		})

		// Attempt still logged for the audit trail, but no points move.
		expect(conn.calls.attemptInsert).toBe(1)
		expect(conn.calls.userPointsUpdate).toBe(0)
		expect(conn.calls.pointTransactionInsert).toBe(0)
		expect(conn.calls.commits).toBeGreaterThan(0)
	})
})
