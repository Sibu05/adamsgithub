import { jest } from '@jest/globals'

// Mock the shared pool BEFORE the router imports it. The router uses
// pool.query() for reads and pool.getConnection() for the transactional
// create/accept paths, so both are stubbed here.
jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
		getConnection: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { default: trades_router } = await import('./trades.js')

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
	app.use('/api/trades', trades_router)
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

// ── Fake transaction connection ─────────────────────────────

function makeConn(opts = {}) {
	const {
		ownership = {},
		rarities = {},
		accountAges = {},
		recentAcceptedTrades = 0,
		lockedTrade = null,
	} = opts

	const calls = {
		commits: 0,
		rollbacks: 0,
		transfers: [],
		tradeInserts: 0,
		tradeUpdates: 0,
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

			if (q.startsWith('select quantity from user_cards')) {
				const [user_id, card_id] = params
				const qty = ownership?.[user_id]?.[card_id] ?? 0
				return [qty > 0 ? [{ quantity: qty }] : []]
			}

			if (q.startsWith('select count(*) as n from trades')) {
				return [[{ n: recentAcceptedTrades }]]
			}

			if (q.startsWith('select card_id, rarity from cards')) {
				const [a, b] = params
				return [
					[a, b]
						.filter((id) => rarities[id])
						.map((id) => ({
							card_id: id,
							rarity: rarities[id],
						})),
				]
			}

			if (q.startsWith('select user_id, timestampdiff')) {
				const [a, b] = params
				return [
					[a, b]
						.filter(
							(id) =>
								accountAges[
									id
								] != null
						)
						.map((id) => ({
							user_id: id,
							age_s: accountAges[id],
						})),
				]
			}

			if (q.startsWith('insert into trades')) {
				calls.tradeInserts++
				return [{ insertId: 123, affectedRows: 1 }]
			}

			if (
				q.startsWith(
					'select * from trades where trade_id'
				) &&
				q.includes('for update')
			) {
				return [lockedTrade ? [lockedTrade] : []]
			}

			if (
				q.startsWith(
					'update user_cards set quantity = quantity - 1'
				)
			) {
				const [from, card_id] = params
				calls.transfers.push({
					from,
					card_id,
					op: 'decrement',
				})
				return [{ affectedRows: 1 }]
			}

			if (
				q.startsWith('delete from user_cards') &&
				q.includes('quantity <= 0')
			) {
				return [{ affectedRows: 1 }]
			}

			if (
				q.startsWith('insert into user_cards') &&
				q.includes('on duplicate key update')
			) {
				const [to, card_id] = params
				calls.transfers.push({
					to,
					card_id,
					op: 'increment',
				})
				return [{ affectedRows: 1 }]
			}

			if (q.startsWith('update trades set status')) {
				calls.tradeUpdates++
				return [{ affectedRows: 1 }]
			}

			return [[]]
		}),
	}
	return conn
}

// ── Sample data ─────────────────────────────────────────────

const CARD_COMMON = {
	card_id: 1,
	name: 'Common Card',
	rarity: 'COMMON',
}
const CARD_RARE = {
	card_id: 2,
	name: 'Rare Card',
	rarity: 'RARE',
}

// Helper: mock the pool.query calls decorateTrade makes (trade,
// cards, users).
function mockDecorate() {
	pool.query
		.mockResolvedValueOnce([
			[
				{
					trade_id: 123,
					initiator_id: 1,
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
					status: 'PENDING',
					created_at: '2026-09-19T10:00:00Z',
					resolved_at: null,
				},
			],
		])
		.mockResolvedValueOnce([[CARD_COMMON, CARD_RARE]])
		.mockResolvedValueOnce([
			[
				{ user_id: 1, name: 'Alice', avatar_url: null },
				{ user_id: 2, name: 'Bob', avatar_url: null },
			],
		])
}

// ── POST /api/trades — create ──────────────────────────────

describe('POST /api/trades', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})

	test('401s when there is no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(401)
		})
	})

	test('400s when required fields are missing', async () => {
		const app = makeApp()
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ receiver_id: 2 }),
			})
			expect(res.status).toBe(400)
		})
	})

	test('400s when trading with yourself', async () => {
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 1,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(/yourself/i)
		})
	})

	test('400s when the initiator does not own the offered card', async () => {
		const conn = makeConn({
			ownership: { 1: {}, 2: { 2: 1 } },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(/do not own/i)
		})
		expect(conn.calls.rollbacks).toBeGreaterThan(0)
	})

	test('429 when the initiator has hit the daily trade cap', async () => {
		const conn = makeConn({
			ownership: { 1: { 1: 1 }, 2: { 2: 1 } },
			recentAcceptedTrades: 5,
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(429)
			const body = await res.json()
			expect(body.error).toMatch(/daily trade limit/i)
		})
	})

	test('400 when the trade values are too asymmetric (COMMON ↔ LEGENDARY)', async () => {
		const conn = makeConn({
			ownership: { 1: { 1: 1 }, 2: { 3: 1 } },
			rarities: { 1: 'COMMON', 3: 'LEGENDARY' },
			accountAges: { 1: 99999, 2: 99999 },
			recentAcceptedTrades: 0,
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 3,
				}),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(/asymmetric/i)
		})
	})

	test('403 when one party’s account is too new', async () => {
		const conn = makeConn({
			ownership: { 1: { 1: 1 }, 2: { 2: 1 } },
			rarities: { 1: 'COMMON', 2: 'UNCOMMON' },
			accountAges: { 1: 30, 2: 99999 },
			recentAcceptedTrades: 0,
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(403)
			const body = await res.json()
			expect(body.error).toMatch(/too new/i)
		})
	})

	test('200 — creates a valid COMMON ↔ UNCOMMON trade', async () => {
		const conn = makeConn({
			ownership: { 1: { 1: 1 }, 2: { 2: 1 } },
			rarities: { 1: 'COMMON', 2: 'UNCOMMON' },
			accountAges: { 1: 99999, 2: 99999 },
			recentAcceptedTrades: 0,
		})
		pool.getConnection.mockResolvedValue(conn)

		mockDecorate()

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/trades`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receiver_id: 2,
					initiator_card_id: 1,
					receiver_card_id: 2,
				}),
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.status).toBe('PENDING')
			expect(body.initiator_card).toMatchObject({
				card_id: 1,
			})
			expect(body.receiver_card).toMatchObject({
				card_id: 2,
			})
		})
		expect(conn.calls.tradeInserts).toBe(1)
		expect(conn.calls.commits).toBe(1)
	})
})

// ── POST /api/trades/:id/accept ────────────────────────────

describe('POST /api/trades/:id/accept', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})

	test('404 when the trade does not exist', async () => {
		const conn = makeConn({ lockedTrade: null })
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/999/accept`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(404)
		})
	})

	test('403 when the caller is not the receiver', async () => {
		const conn = makeConn({
			lockedTrade: {
				trade_id: 123,
				initiator_id: 1,
				receiver_id: 2,
				initiator_card_id: 1,
				receiver_card_id: 2,
				status: 'PENDING',
			},
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 99 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/accept`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(403)
		})
	})

	test('409 when the trade is not PENDING', async () => {
		const conn = makeConn({
			lockedTrade: {
				trade_id: 123,
				initiator_id: 1,
				receiver_id: 2,
				initiator_card_id: 1,
				receiver_card_id: 2,
				status: 'CANCELLED',
			},
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/accept`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(409)
			const body = await res.json()
			expect(body.error).toMatch(/cancelled/i)
		})
	})

	test('409 when the initiator no longer owns their card', async () => {
		const conn = makeConn({
			lockedTrade: {
				trade_id: 123,
				initiator_id: 1,
				receiver_id: 2,
				initiator_card_id: 1,
				receiver_card_id: 2,
				status: 'PENDING',
			},
			ownership: { 1: {}, 2: { 2: 1 } },
		})
		pool.getConnection.mockResolvedValue(conn)

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/accept`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(409)
			const body = await res.json()
			expect(body.error).toMatch(
				/INITIATOR_NO_LONGER_OWNS_CARD/
			)
		})
		expect(conn.calls.transfers).toHaveLength(0)
	})

	test('200 — happy path swaps both cards atomically', async () => {
		const conn = makeConn({
			lockedTrade: {
				trade_id: 123,
				initiator_id: 1,
				receiver_id: 2,
				initiator_card_id: 1,
				receiver_card_id: 2,
				status: 'PENDING',
			},
			ownership: { 1: { 1: 1 }, 2: { 2: 1 } },
		})
		pool.getConnection.mockResolvedValue(conn)

		mockDecorate()

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/accept`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(200)
		})

		const ops = conn.calls.transfers
		expect(ops).toContainEqual({
			from: 1,
			card_id: 1,
			op: 'decrement',
		})
		expect(ops).toContainEqual({
			to: 2,
			card_id: 1,
			op: 'increment',
		})
		expect(ops).toContainEqual({
			from: 2,
			card_id: 2,
			op: 'decrement',
		})
		expect(ops).toContainEqual({
			to: 1,
			card_id: 2,
			op: 'increment',
		})

		expect(conn.calls.tradeUpdates).toBe(1)
		expect(conn.calls.commits).toBe(1)
	})
})

// ── POST /api/trades/:id/decline ───────────────────────────

describe('POST /api/trades/:id/decline', () => {
	beforeEach(() => pool.query.mockReset())

	test('403 when the caller is not the receiver', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{
					trade_id: 123,
					initiator_id: 1,
					receiver_id: 2,
					status: 'PENDING',
				},
			],
		])

		const app = makeApp({ user_id: 99 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/decline`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(403)
		})
	})

	test('200 — receiver declines a pending trade', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{
					trade_id: 123,
					initiator_id: 1,
					receiver_id: 2,
					status: 'PENDING',
				},
			],
		])
		pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/decline`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.message).toMatch(/declined/i)
		})
	})
})

// ── POST /api/trades/:id/cancel ────────────────────────────

describe('POST /api/trades/:id/cancel', () => {
	beforeEach(() => pool.query.mockReset())

	test('403 when the caller is not the initiator', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{
					trade_id: 123,
					initiator_id: 1,
					receiver_id: 2,
					status: 'PENDING',
				},
			],
		])

		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/cancel`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(403)
		})
	})

	test('200 — initiator cancels their own pending trade', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{
					trade_id: 123,
					initiator_id: 1,
					receiver_id: 2,
					status: 'PENDING',
				},
			],
		])
		pool.query.mockResolvedValueOnce([{ affectedRows: 1 }])

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/trades/123/cancel`,
				{ method: 'POST' }
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.message).toMatch(/cancelled/i)
		})
	})
})
