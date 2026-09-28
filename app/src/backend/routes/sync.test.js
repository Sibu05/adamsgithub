import { jest } from '@jest/globals'

// Mock the shared pool BEFORE the router imports it. The route calls
// pool.getConnection() once per queued attempt and manages begin/commit/
// rollback on the connection it receives.
jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		getConnection: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { default: sync_router } = await import('./sync.js')

import express from 'express'
import { createServer } from 'http'

// ── Test harness ────────────────────────────────────────────
// Mounts the sync router on a bare Express app with a fake session,
// starts an HTTP listener on an ephemeral port, and drives it with
// fetch. Mirrors the pattern used in leaderboard.test.js.

function makeApp(sessionUser = { user_id: 1 }) {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = sessionUser ? { user: sessionUser } : {}
		next()
	})
	app.use('/api/trivia', sync_router)
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

// ── Fake connection builder ────────────────────────────────
// Returns a conn object whose .query() dispatches on the SQL prefix
// and returns canned rows. Writes are counted so tests can assert
// on which INSERT / UPDATE statements fired.

function makeConn(opts = {}) {
	const {
		event = null, // null = event not found
		option = null, // null = option not found
		cardAward = { awarded: false, card: null, card_id: null },
	} = opts

	const calls = {
		offlineQueueInserts: [],
		locationCheckInserts: 0,
		triviaAttemptInserts: 0,
		userPointsUpdates: 0,
		pointTransactionInserts: 0,
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
		query: jest.fn(async (sql, params) => {
			const q = String(sql)
				.trim()
				.toLowerCase()
				.replace(/\s+/g, ' ')

			// SELECT event by id
			if (q.startsWith('select event_id, latitude')) {
				return [event ? [event] : []]
			}

			// SELECT option correctness
			if (
				q.startsWith(
					'select is_correct from trivia_options'
				)
			) {
				return [option ? [option] : []]
			}

			// INSERT location_check_log (only in the accepted path)
			if (q.startsWith('insert into location_check_log')) {
				calls.locationCheckInserts++
				return [{ insertId: 999, affectedRows: 1 }]
			}

			// INSERT trivia_attempts (only in the accepted path)
			if (q.startsWith('insert into trivia_attempts')) {
				calls.triviaAttemptInserts++
				return [{ insertId: 1000, affectedRows: 1 }]
			}

			// UPDATE users SET points
			if (q.startsWith('update users set points')) {
				calls.userPointsUpdates++
				return [{ affectedRows: 1 }]
			}

			// INSERT point_transactions
			if (q.startsWith('insert into point_transactions')) {
				calls.pointTransactionInserts++
				return [{ insertId: 1, affectedRows: 1 }]
			}

			// INSERT offline_trivia_queue — captures the status param
			if (q.startsWith('insert into offline_trivia_queue')) {
				// Status is a literal in the SQL, not a bound param. Pull it out
				// of the VALUES clause: VALUES (?, ?, ?, ?, ?, ?, ?, 'STATUS')
				const match = q.match(
					/values\s*\([^)]*'([a-z_]+)'\)/i
				)
				calls.offlineQueueInserts.push(
					match ? match[1].toUpperCase() : null
				)
				return [{ insertId: 1, affectedRows: 1 }]
			}

			// Anything else — return empty to avoid crashes on unexpected queries
			return [[]]
		}),
	}
	return conn
}

function validEvent(overrides = {}) {
	return {
		event_id: 1,
		latitude: -26.1905,
		longitude: 28.0285,
		radius_meters: 100,
		point_reward: 10,
		starts_at: null,
		ends_at: null,
		is_active: true,
		...overrides,
	}
}

function validAttempt(overrides = {}) {
	return {
		event_id: 1,
		question_id: 1,
		selected_option_id: 1,
		answer_time_ms: 1500,
		claimed_lat: -26.1905,
		claimed_lng: 28.0285,
		client_timestamp: '2026-09-11T10:00:00.000Z',
		...overrides,
	}
}

async function post(base, body, sessionUser = { user_id: 1 }) {
	return fetch(`${base}/api/trivia/offline-attempts`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

// ── Tests ───────────────────────────────────────────────────

describe('POST /api/trivia/offline-attempts — request validation', () => {
	beforeEach(() => pool.getConnection.mockReset())

	test('401s when there is no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await post(base, { queued_attempts: [] })
			expect(res.status).toBe(401)
		})
		expect(pool.getConnection).not.toHaveBeenCalled()
	})

	test('400s when queued_attempts is missing or empty', async () => {
		const app = makeApp()
		await withServer(app, async (base) => {
			const res1 = await post(base, {})
			expect(res1.status).toBe(400)

			const res2 = await post(base, { queued_attempts: [] })
			expect(res2.status).toBe(400)
		})
	})

	test('rejects a malformed attempt with REJECTED_MALFORMED_PAYLOAD', async () => {
		// A missing field for an otherwise well-formed request.
		const conn = makeConn({ event: validEvent() })
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					{
						event_id: 1,
						// question_id intentionally omitted
						selected_option_id: 1,
						claimed_lat: -26.1905,
						claimed_lng: 28.0285,
						client_timestamp:
							'2026-09-11T10:00:00.000Z',
					},
				],
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.results).toHaveLength(1)
			expect(body.results[0].status).toBe(
				'REJECTED_MALFORMED_PAYLOAD'
			)
		})
		// Malformed payloads are rejected before touching the DB.
		expect(pool.getConnection).not.toHaveBeenCalled()
	})

	test('rejects an attempt with invalid lat/lng or timestamp', async () => {
		const conn = makeConn({ event: validEvent() })
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt({
						claimed_lat: 'not-a-number',
						client_timestamp: 'banana',
					}),
				],
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_INVALID_DATA'
			)
		})
		expect(pool.getConnection).not.toHaveBeenCalled()
	})
})

describe('POST /api/trivia/offline-attempts — per-attempt verification', () => {
	beforeEach(() => pool.getConnection.mockReset())

	test('REJECTED_EVENT_NOT_FOUND when the event does not exist', async () => {
		const conn = makeConn({ event: null })
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [validAttempt()],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_EVENT_NOT_FOUND'
			)
		})
		// No acceptance-path writes should have happened.
		expect(conn.calls.locationCheckInserts).toBe(0)
		expect(conn.calls.userPointsUpdates).toBe(0)
	})

	test('REJECTED_WINDOW_EXPIRED when the timestamp is before starts_at', async () => {
		const conn = makeConn({
			event: validEvent({
				starts_at: '2026-09-12T00:00:00.000Z',
				ends_at: '2026-09-13T00:00:00.000Z',
			}),
			option: { is_correct: 1 },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt({
						client_timestamp:
							'2026-09-11T10:00:00.000Z', // before starts_at
					}),
				],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_WINDOW_EXPIRED'
			)
		})
		expect(conn.calls.offlineQueueInserts).toContain(
			'REJECTED_WINDOW_EXPIRED'
		)
		expect(conn.calls.userPointsUpdates).toBe(0)
	})

	test('REJECTED_WINDOW_EXPIRED when the timestamp is after ends_at', async () => {
		const conn = makeConn({
			event: validEvent({
				starts_at: '2026-09-01T00:00:00.000Z',
				ends_at: '2026-09-05T00:00:00.000Z',
			}),
			option: { is_correct: 1 },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt({
						client_timestamp:
							'2026-09-10T10:00:00.000Z', // after ends_at
					}),
				],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_WINDOW_EXPIRED'
			)
		})
		expect(conn.calls.userPointsUpdates).toBe(0)
	})

	test('ACCEPTED when the event has since expired but was valid at capture time', async () => {
		// The story's key case: event ends_at is in the past, but the
		// captured client_timestamp falls inside the window. Should count.
		const conn = makeConn({
			event: validEvent({
				starts_at: '2026-09-10T00:00:00.000Z',
				ends_at: '2026-09-10T23:59:59.000Z', // already over
			}),
			option: { is_correct: 1 },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt({
						client_timestamp:
							'2026-09-10T12:00:00.000Z', // mid-window
					}),
				],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe('ACCEPTED')
			expect(body.results[0].points_awarded).toBe(10)
		})
		expect(conn.calls.userPointsUpdates).toBe(1)
	})

	test('REJECTED_GEOFENCE when claimed location is outside radius', async () => {
		// ~1.1 km away from the event — well outside a 100 m radius.
		const conn = makeConn({
			event: validEvent({
				latitude: -26.1905,
				longitude: 28.0285,
				radius_meters: 100,
			}),
			option: { is_correct: 1 },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt({
						claimed_lat: -26.2,
						claimed_lng: 28.0285,
					}),
				],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe('REJECTED_GEOFENCE')
		})
		expect(conn.calls.userPointsUpdates).toBe(0)
	})

	test('REJECTED_INVALID_OPTION when the option does not belong to the question', async () => {
		const conn = makeConn({
			event: validEvent(),
			option: null, // option lookup returns nothing
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [validAttempt()],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_INVALID_OPTION'
			)
		})
		// The route rolls back rather than committing in this branch.
		expect(conn.calls.rollbacks).toBeGreaterThan(0)
	})

	test('REJECTED_WRONG_ANSWER when the option is valid but incorrect', async () => {
		const conn = makeConn({
			event: validEvent(),
			option: { is_correct: 0 },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [validAttempt()],
			})
			const body = await res.json()
			expect(body.results[0].status).toBe(
				'REJECTED_WRONG_ANSWER'
			)
		})
		expect(conn.calls.userPointsUpdates).toBe(0)
	})

	test('ACCEPTED replay of a completed event logs the attempt but awards 0 points', async () => {
		const conn = makeConn({
			event: validEvent(),
			option: { is_correct: 1 },
		})
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
			const res = await post(base, {
				queued_attempts: [validAttempt()],
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.results).toHaveLength(1)
			expect(body.results[0].status).toBe('ACCEPTED')
			expect(body.results[0].points_awarded).toBe(0)
			expect(body.results[0].already_completed).toBe(true)
		})

		// Attempt + queue rows still logged, but no points move.
		expect(conn.calls.triviaAttemptInserts).toBe(1)
		expect(conn.calls.userPointsUpdates).toBe(0)
		expect(conn.calls.pointTransactionInserts).toBe(0)
		expect(conn.calls.offlineQueueInserts).toContain('ACCEPTED')
		expect(conn.calls.commits).toBeGreaterThan(0)
	})

	test('ACCEPTED — happy path credits points and logs everything', async () => {
		const conn = makeConn({
			event: validEvent(),
			option: { is_correct: 1 },
			cardAward: {
				awarded: true,
				card: { card_id: 5, name: 'Barney Barnato' },
				card_id: 5,
			},
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [validAttempt()],
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.synced).toBe(true)
			expect(body.results).toHaveLength(1)
			expect(body.results[0].status).toBe('ACCEPTED')
			expect(body.results[0].points_awarded).toBe(10)
		})

		// All expected writes fired.
		expect(conn.calls.locationCheckInserts).toBe(1)
		expect(conn.calls.triviaAttemptInserts).toBe(1)
		expect(conn.calls.userPointsUpdates).toBe(1)
		expect(conn.calls.pointTransactionInserts).toBe(1)
		expect(conn.calls.offlineQueueInserts).toContain('ACCEPTED')
		expect(conn.calls.commits).toBeGreaterThan(0)
	})
})

describe('POST /api/trivia/offline-attempts — batch behaviour', () => {
	beforeEach(() => pool.getConnection.mockReset())

	test('processes a mixed batch and returns per-attempt status', async () => {
		// Three attempts: one valid, one geofence-rejected, one malformed.
		// Each attempt gets its own connection from the pool.
		const connGood = makeConn({
			event: validEvent(),
			option: { is_correct: 1 },
		})
		const connGeofence = makeConn({
			event: validEvent({ radius_meters: 50 }),
			option: { is_correct: 1 },
		})

		pool.getConnection
			.mockResolvedValueOnce(connGood)
			.mockResolvedValueOnce(connGeofence)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await post(base, {
				queued_attempts: [
					validAttempt(),
					validAttempt({
						claimed_lat: -26.2,
						claimed_lng: 28.0285,
					}),
					{ event_id: 1 }, // malformed
				],
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.results).toHaveLength(3)
			expect(body.results[0].status).toBe('ACCEPTED')
			expect(body.results[1].status).toBe('REJECTED_GEOFENCE')
			expect(body.results[2].status).toBe(
				'REJECTED_MALFORMED_PAYLOAD'
			)
		})

		// The good attempt's transaction committed; the geofence
		// attempt also commits (it logs the rejection) but produces
		// no points.
		expect(connGood.calls.userPointsUpdates).toBe(1)
		expect(connGeofence.calls.userPointsUpdates).toBe(0)
	})
})
