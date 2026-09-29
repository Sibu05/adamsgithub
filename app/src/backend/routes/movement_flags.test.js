import { jest } from '@jest/globals'

jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))

const { default: pool } = await import('../utils/db.js')
const { default: flagsRouter } = await import('./movement_flags.js')

import express from 'express'
import { createServer } from 'http'

function makeApp(sessionUser = { user_id: 1 }) {
	const session = sessionUser ? { user: sessionUser } : {}
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = session
		req.user = sessionUser ?? null
		next()
	})
	app.use('/api/movement-flags', flagsRouter)
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

beforeEach(() => {
	pool.query.mockReset()
})

describe('GET /api/movement-flags', () => {
	test('401 when no session', async () => {
		await withServer(makeApp(null), async (base) => {
			const res = await fetch(`${base}/api/movement-flags`)
			expect(res.status).toBe(401)
		})
	})

	test('403 for a regular player', async () => {
		pool.query.mockResolvedValueOnce([[]]) // admin_roles: none
		await withServer(makeApp({ user_id: 5 }), async (base) => {
			const res = await fetch(`${base}/api/movement-flags`)
			expect(res.status).toBe(403)
		})
	})

	test('200 lists flagged checks for a moderator', async () => {
		const row = {
			check_id: 7,
			user_id: 3,
			user_name: 'Speedy',
			travel_speed_ms: '66.68',
			prev_check_id: 6,
		}
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // admin_roles: moderator
			.mockResolvedValueOnce([[row]])
		await withServer(makeApp({ user_id: 2 }), async (base) => {
			const res = await fetch(`${base}/api/movement-flags`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.flags).toEqual([row])
			expect(body.threshold_mps).toBe(2.5)
			expect(body.limit).toBe(50)
		})
		const [sql, params] = pool.query.mock.calls[1]
		expect(sql).toMatch(/movement_flagged = TRUE/)
		expect(params).toEqual([50, 0])
	})

	test('filters by user_id and clamps limit', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[]])
		await withServer(makeApp({ user_id: 2 }), async (base) => {
			const res = await fetch(
				`${base}/api/movement-flags?user_id=3&limit=9999`
			)
			expect(res.status).toBe(200)
		})
		const [sql, params] = pool.query.mock.calls[1]
		expect(sql).toMatch(/l\.user_id = \?/)
		expect(params).toEqual([3, 200, 0])
	})

	test('500 when the query fails', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockRejectedValueOnce(new Error('boom'))
		await withServer(makeApp({ user_id: 2 }), async (base) => {
			const res = await fetch(`${base}/api/movement-flags`)
			expect(res.status).toBe(500)
		})
	})
})
