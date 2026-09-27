import { jest } from '@jest/globals'
jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))
jest.unstable_mockModule('../utils/battle.js', () => ({
	valid_user_cards: jest.fn().mockResolvedValue(true),
}))
jest.unstable_mockModule('../utils/rarity_points.js', () => ({
	RARITY_POINTS: {
		COMMON: 5,
		UNCOMMON: 10,
		RARE: 20,
		EPIC: 50,
		LEGENDARY: 100,
	},
}))
const { default: pool } = await import('../utils/db.js')
const { default: cardsRouter } = await import('./cards.js')
import express from 'express'
import { createServer } from 'http'

function makeApp(user = { user_id: 1 }) {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.user = user
		req.session = user ? { user } : {}
		next()
	})
	app.use('/api/cards', cardsRouter)
	return app
}
async function withServer(app, fn) {
	const server = createServer(app)
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const { port } = server.address()
	try {
		await fn(`http://127.0.0.1:${port}`)
	} finally {
		await new Promise((r) => server.close(r))
	}
}

describe('GET /api/cards', () => {
	beforeEach(() => pool.query.mockReset())
	test('200 returns cards', async () => {
		pool.query.mockResolvedValueOnce([[{ card_id: 1, name: 'A' }]])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`)
			expect(res.status).toBe(200)
			expect(await res.json()).toHaveLength(1)
		})
	})
	test('GET /:id 404 when not found', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/999`)
			expect(res.status).toBe(404)
		})
	})
	test('GET /:id 200 when found', async () => {
		pool.query.mockResolvedValueOnce([[{ card_id: 1, name: 'A' }]])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/1`)
			expect(res.status).toBe(200)
		})
	})
})

describe('GET /api/cards/collection/mine', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no auth', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/cards/collection/mine`
			)
			expect(res.status).toBe(401)
		})
	})
	test('200 when auth', async () => {
		pool.query.mockResolvedValueOnce([
			[{ user_card_id: 1, card_id: 1 }],
		])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/cards/collection/mine`
			)
			expect(res.status).toBe(200)
		})
	})
	test('each card carries its sell_value (points per duplicate sold)', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{ card_id: 1, rarity: 'RARE', quantity: 3 },
				{
					card_id: 2,
					rarity: 'LEGENDARY',
					quantity: 1,
				},
			],
		])
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			const body = await (
				await fetch(`${base}/api/cards/collection/mine`)
			).json()
			expect(body.map((c) => c.sell_value)).toEqual([20, 100])
		})
	})
})

describe('POST /api/cards', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no auth', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'X' }),
			})
			expect(res.status).toBe(401)
		})
	})
	test('403 when not card author', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'X',
					category: 'CHARACTER',
					rarity: 'COMMON',
				}),
			})
			expect(res.status).toBe(403)
		})
	})
	test('400 when missing fields', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: '' }),
			})
			expect(res.status).toBe(400)
		})
	})
	test('400 invalid category', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'X',
					category: 'BAD',
					rarity: 'COMMON',
				}),
			})
			expect(res.status).toBe(400)
		})
	})
	test('400 invalid rarity', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/campaigns`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
			// not relevant, test cards rarity
			const res2 = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'X',
					category: 'CHARACTER',
					rarity: 'BAD',
				}),
			})
			expect(res2.status).toBe(400)
		})
	})
	test('201 creates card', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ insertId: 10 }])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'X',
					category: 'CHARACTER',
					rarity: 'COMMON',
				}),
			})
			expect(res.status).toBe(201)
		})
	})
})

describe('PUT /api/cards/:id', () => {
	beforeEach(() => pool.query.mockReset())
	test('404 when not found', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ affectedRows: 0 }])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/999`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'X',
					category: 'CHARACTER',
					rarity: 'COMMON',
				}),
			})
			expect(res.status).toBe(404)
		})
	})
})

describe('DELETE /api/cards/:id', () => {
	beforeEach(() => pool.query.mockReset())
	test('409 when still referenced', async () => {
		const err = new Error('fk')
		err.code = 'ER_ROW_IS_REFERENCED_2'
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockRejectedValueOnce(err)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/1`, {
				method: 'DELETE',
			})
			expect(res.status).toBe(409)
		})
	})
	test('200 delete', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/1`, {
				method: 'DELETE',
			})
			expect(res.status).toBe(200)
		})
	})
})

describe('POST /api/cards/sell', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})
	function makeConn(rows) {
		return {
			beginTransaction: jest.fn(),
			commit: jest.fn(),
			rollback: jest.fn(),
			release: jest.fn(),
			query: jest.fn(async (sql) => {
				const q = sql.toLowerCase()
				if (q.includes('select uc.user_card_id'))
					return [rows]
				if (q.includes('update user_cards'))
					return [{ affectedRows: 1 }]
				if (q.includes('update users set points'))
					return [{ affectedRows: 1 }]
				if (
					q.includes(
						'insert into point_transactions'
					)
				)
					return [{ affectedRows: 1 }]
				if (q.includes('select points from users'))
					return [[{ points: 140 }]]
				return [[]]
			}),
		}
	}
	test('400 when bad quantity', async () => {
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/sell`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					card_id: 1,
					quantity: 0,
				}),
			})
			expect(res.status).toBe(400)
		})
	})
	test('404 when not owned', async () => {
		const conn = makeConn([])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/sell`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					card_id: 1,
					quantity: 1,
				}),
			})
			expect(res.status).toBe(404)
		})
	})
	test('400 when trying to sell last copy', async () => {
		const conn = makeConn([
			{ user_card_id: 1, quantity: 1, rarity: 'COMMON' },
		])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/sell`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					card_id: 1,
					quantity: 1,
				}),
			})
			expect(res.status).toBe(400)
		})
	})
	test('200 sells duplicate', async () => {
		const conn = makeConn([
			{ user_card_id: 1, quantity: 3, rarity: 'RARE' },
		])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/cards/sell`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					card_id: 1,
					quantity: 2,
				}),
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.success).toBe(true)
			expect(body.points_earned).toBe(40) // RARE 20 *2
			expect(body.remaining_quantity).toBe(1)
			expect(body.points_total).toBe(140)
		})
		// Quantity, points and ledger all change, in one transaction.
		const sqls = conn.query.mock.calls.map(([sql]) =>
			sql.replace(/\s+/g, ' ').trim()
		)
		expect(sqls).toEqual(
			expect.arrayContaining([
				expect.stringMatching(
					/^UPDATE user_cards SET quantity = quantity - \?/
				),
				expect.stringMatching(
					/^UPDATE users SET points = points \+ \?/
				),
				expect.stringMatching(
					/INSERT INTO point_transactions/
				),
			])
		)
		expect(conn.commit).toHaveBeenCalledTimes(1)
	})
})
