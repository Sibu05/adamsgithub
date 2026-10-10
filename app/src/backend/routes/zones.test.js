import { jest } from '@jest/globals'

// Mock the shared pool before the router imports it. The zones
// router uses pool.query() exclusively — no transactions, since
// ownership is resolved by a deterministic read-time function.
jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { default: zones_router } = await import('./zones.js')

import express from 'express'
import { createServer } from 'http'

// ── Test harness ────────────────────────────────────────────

function makeApp(sessionUser = { user_id: 1 }) {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.user = sessionUser
		req.session = sessionUser ? { user: sessionUser } : {}
		next()
	})
	app.use('/api/zones', zones_router)
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

// ── Helpers to mock pool.query by SQL shape ─────────────────
//
// Because the router runs many differently-shaped queries in
// sequence (event lookup, current owner, scoreboard, persist,
// stipend check), the most robust approach is a dispatcher that
// matches on the SQL prefix and returns canned responses based
// on a shared scenario object.

function makeDispatcher(scenario) {
	return jest.fn(async (sql, params) => {
		const q = String(sql).trim().toLowerCase().replace(/\s+/g, ' ')

		// Event existence check
		if (
			q.startsWith(
				'select event_id, title, radius_meters from events'
			)
		) {
			return [scenario.event ? [scenario.event] : []]
		}

		// Stored owner lookup (zone_owners)
		if (q.startsWith('select owner_id, score from zone_owners')) {
			return [
				scenario.storedOwner
					? [scenario.storedOwner]
					: [],
			]
		}

		// Scoreboard computation
		if (
			q.startsWith(
				'select ta.user_id, u.name, sum(ta.points_awarded) as points'
			)
		) {
			return [scenario.scoreboard || []]
		}

		// Upsert owner
		if (q.startsWith('insert into zone_owners')) {
			scenario.persisted = {
				event_id: params[0],
				owner_id: params[1],
				score: params[2],
			}
			return [{ affectedRows: 1 }]
		}

		// Delete stale owner
		if (q.startsWith('delete from zone_owners')) {
			scenario.persistedDeleted = true
			return [{ affectedRows: 1 }]
		}

		// GET /api/zones — list all
		if (
			q.startsWith(
				'select zo.event_id, e.title as event_title, zo.owner_id'
			)
		) {
			return [scenario.allZones || []]
		}

		// GET /api/zones/mine — zones owned by user
		if (
			q.startsWith(
				'select zo.event_id, e.title as event_title, zo.score'
			)
		) {
			return [scenario.myZones || []]
		}

		// Stipend: count zones owned
		if (q.startsWith('select count(*) as n from zone_owners')) {
			return [[{ n: scenario.zoneCount ?? 0 }]]
		}

		// Stipend: has ZONE_BONUS been paid today?
		if (
			q.startsWith(
				'select count(*) as paid from point_transactions'
			)
		) {
			return [[{ paid: scenario.paidToday ?? 0 }]]
		}

		// Stipend: insert transaction
		if (q.startsWith('insert into point_transactions')) {
			scenario.stipendAwarded = params[1]
			return [{ insertId: 1, affectedRows: 1 }]
		}

		// Stipend: update user points
		if (q.startsWith('update users set points')) {
			return [{ affectedRows: 1 }]
		}

		return [[]]
	})
}

// ── GET /api/zones ──────────────────────────────────────────

describe('GET /api/zones', () => {
	beforeEach(() => pool.query.mockReset())

	test('200 — returns all currently-owned zones (public read)', async () => {
		const scenario = {
			allZones: [
				{
					event_id: 1,
					event_title: 'Great Hall',
					owner_id: 5,
					owner_name: 'Alice',
					score: 120,
					updated_at: '2026-09-21T10:00:00Z',
				},
				{
					event_id: 2,
					event_title: 'Wits Museum',
					owner_id: 6,
					owner_name: 'Bob',
					score: 80,
					updated_at: '2026-09-21T09:00:00Z',
				},
			],
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp(null) // no session — should still work
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toHaveLength(2)
			expect(body[0]).toMatchObject({
				event_id: 1,
				owner_name: 'Alice',
				score: 120,
			})
		})
	})
})

// ── GET /api/zones/:eventId ────────────────────────────────

describe('GET /api/zones/:eventId', () => {
	beforeEach(() => pool.query.mockReset())

	test('401 without a session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/1`)
			expect(res.status).toBe(401)
		})
	})

	test('404 when the event does not exist', async () => {
		const scenario = { event: null }
		pool.query = makeDispatcher(scenario)

		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/999`)
			expect(res.status).toBe(404)
		})
	})

	test('200 — first claim: no prior owner, highest score wins', async () => {
		const scenario = {
			event: {
				event_id: 1,
				title: 'Great Hall',
				radius_meters: 100,
			},
			storedOwner: null, // no current owner
			scoreboard: [
				{ user_id: 5, name: 'Alice', points: 120 },
				{ user_id: 6, name: 'Bob', points: 80 },
			],
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/1`)
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.owner.user_id).toBe(5)
			expect(body.owner.name).toBe('Alice')
			expect(body.owner.score).toBe(120)
			expect(body.owner_changed).toBe(true)
			expect(body.scoreboard).toHaveLength(2)
		})

		// The owner was persisted.
		expect(scenario.persisted).toMatchObject({
			event_id: 1,
			owner_id: 5,
			score: 120,
		})
	})

	test('200 — incumbent defends: challenger does not exceed 1.2× bonus', async () => {
		// Incumbent (id 5) has 100 points cached. Their defence
		// threshold is 120. Challenger (id 6) has 110 — loses.
		const scenario = {
			event: {
				event_id: 1,
				title: 'Great Hall',
				radius_meters: 100,
			},
			storedOwner: { owner_id: 5, score: 100 },
			scoreboard: [
				{ user_id: 6, name: 'Bob', points: 110 },
				{ user_id: 5, name: 'Alice', points: 100 },
			],
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 6 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/1`)
			expect(res.status).toBe(200)
			const body = await res.json()

			// Incumbent retained
			expect(body.owner.user_id).toBe(5)
			expect(body.owner_changed).toBe(false)
		})
	})

	test('200 — challenger overtakes: score > 1.2× incumbent', async () => {
		// Incumbent (id 5) has 100 → threshold 120. Challenger
		// (id 6) has 130 — wins.
		const scenario = {
			event: {
				event_id: 1,
				title: 'Great Hall',
				radius_meters: 100,
			},
			storedOwner: { owner_id: 5, score: 100 },
			scoreboard: [
				{ user_id: 6, name: 'Bob', points: 130 },
				{ user_id: 5, name: 'Alice', points: 100 },
			],
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 6 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/1`)
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.owner.user_id).toBe(6)
			expect(body.owner_changed).toBe(true)
			expect(body.previous_owner_id).toBe(5)
		})
		expect(scenario.persisted).toMatchObject({
			owner_id: 6,
			score: 130,
		})
	})

	test('200 — no activity in window: owner is cleared', async () => {
		const scenario = {
			event: {
				event_id: 1,
				title: 'Great Hall',
				radius_meters: 100,
			},
			storedOwner: { owner_id: 5, score: 100 },
			scoreboard: [], // nobody active in the last 24h
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/1`)
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.owner).toBeNull()
			expect(body.owner_changed).toBe(true)
			expect(body.previous_owner_id).toBe(5)
		})
		expect(scenario.persistedDeleted).toBe(true)
	})
})

// ── GET /api/zones/mine ────────────────────────────────────

describe('GET /api/zones/mine', () => {
	beforeEach(() => pool.query.mockReset())

	test('401 without a session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/mine`)
			expect(res.status).toBe(401)
		})
	})

	test('200 — lists owned zones, no bonus when under 3', async () => {
		const scenario = {
			myZones: [
				{
					event_id: 1,
					event_title: 'Great Hall',
					score: 120,
				},
				{
					event_id: 2,
					event_title: 'Wits Museum',
					score: 80,
				},
			],
			zoneCount: 2, // under tier 3-4
			paidToday: 0,
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/mine`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.zones).toHaveLength(2)
			expect(body.zone_count).toBe(2)
			expect(body.bonus_awarded_today).toBe(0)
		})
		expect(scenario.stipendAwarded).toBeUndefined()
	})

	test('200 — awards +50 for owning 3 zones', async () => {
		const scenario = {
			myZones: [
				{ event_id: 1, event_title: 'A', score: 100 },
				{ event_id: 2, event_title: 'B', score: 80 },
				{ event_id: 3, event_title: 'C', score: 60 },
			],
			zoneCount: 3,
			paidToday: 0,
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/mine`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.zone_count).toBe(3)
			expect(body.bonus_awarded_today).toBe(50)
		})
		expect(scenario.stipendAwarded).toBe(50)
	})

	test('200 — awards +150 for owning 5+ zones', async () => {
		const scenario = {
			myZones: Array.from({ length: 6 }, (_, i) => ({
				event_id: i + 1,
				event_title: `Zone ${i + 1}`,
				score: 100 - i * 5,
			})),
			zoneCount: 6,
			paidToday: 0,
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/mine`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.zone_count).toBe(6)
			expect(body.bonus_awarded_today).toBe(150)
		})
		expect(scenario.stipendAwarded).toBe(150)
	})

	test('200 — no double-award if ZONE_BONUS already paid today', async () => {
		const scenario = {
			myZones: [
				{ event_id: 1, event_title: 'A', score: 100 },
				{ event_id: 2, event_title: 'B', score: 80 },
				{ event_id: 3, event_title: 'C', score: 60 },
			],
			zoneCount: 3,
			paidToday: 1, // already received
		}
		pool.query = makeDispatcher(scenario)

		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/zones/mine`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.bonus_awarded_today).toBe(0)
		})
		expect(scenario.stipendAwarded).toBeUndefined()
	})
})
