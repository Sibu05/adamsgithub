import { jest } from '@jest/globals'
jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))
const { default: pool } = await import('../utils/db.js')
const { default: moderationRouter } = await import('./moderation.js')
import express from 'express'
import { createServer } from 'http'

function makeApp(sessionUser = { user_id: 1 }) {
	const session = sessionUser ? { user: sessionUser } : {}
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = session
		req.user = sessionUser
		next()
	})
	app.use('/api/moderation', moderationRouter)
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

describe('GET /api/moderation/flagged', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/flagged`
			)
			expect(res.status).toBe(401)
		})
	})
	test('403 when not moderator', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/flagged`
			)
			expect(res.status).toBe(403)
		})
	})
	test('200 returns flagged sorted by trust_score ASC with evidence', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // moderator check
			.mockResolvedValueOnce([
				[{ moderation_status: 'NONE' }],
			]) // SHOW COLUMNS for hasModerationCols
			.mockResolvedValueOnce([
				[
					{
						user_id: 2,
						name: 'Bob',
						email: 'bob@example.com',
						avatar_url: null,
						points: 90,
						moderation_status: 'NONE',
						moderation_expires_at: null,
						trust_score: 22.5,
						evidence: JSON.stringify([
							{
								type: 'SPOOFED_LOCATION',
								detail: 'spoof',
							},
						]),
						reason: 'spoof',
						updated_at: '2026-01-04T10:00:00Z',
					},
					{
						user_id: 4,
						name: 'Player',
						email: 'player@example.com',
						avatar_url: null,
						points: 10,
						moderation_status: 'WARNED',
						moderation_expires_at: null,
						trust_score: 44,
						evidence: JSON.stringify([]),
						reason: 'velocity',
						updated_at: '2026-01-05T09:00:00Z',
					},
				],
			]) // flagged query
			.mockResolvedValueOnce([[]]) // prior for 2
			.mockResolvedValueOnce([[]]) // live evidence for 2
			.mockResolvedValueOnce([[]]) // prior for 4
			.mockResolvedValueOnce([[]]) // live evidence for 4

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/flagged`
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toHaveLength(2)
			expect(body[0].trust_score).toBe(22.5)
			expect(body[1].trust_score).toBe(44)
			// sorted lowest first
			expect(body[0].user_id).toBe(2)
			expect(body[0].evidence).toBeDefined()
			expect(body[0].recommended_action).toBe('SUSPENSION')
			expect(body[1].recommended_action).toBe('RESTRICTION')
		})
	})
})

describe('POST /api/moderation/action', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/action`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						target_user_id: 2,
						action_type: 'WARNING',
					}),
				}
			)
			expect(res.status).toBe(401)
		})
	})
	test('400 when invalid tier', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]]) // moderator ok
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/action`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						target_user_id: 2,
						action_type: 'BAN',
					}),
				}
			)
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error).toMatch(/must be one of/)
		})
	})
	test('400 when moderating self', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/action`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						target_user_id: 1,
						action_type: 'WARNING',
					}),
				}
			)
			expect(res.status).toBe(400)
			expect((await res.json()).error).toMatch(
				/cannot moderate yourself/i
			)
		})
	})
	test('201 applies graduated action (warning → restriction → suspension)', async () => {
		// mock moderator check
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		// target exists
		pool.query.mockResolvedValueOnce([[{ user_id: 2 }]])
		// prior actions
		pool.query.mockResolvedValueOnce([[]])
		// trust_score
		pool.query.mockResolvedValueOnce([[{ trust_score: 22.5 }]])
		// transaction getConnection
		const mockConn = {
			beginTransaction: jest.fn(),
			query: jest
				.fn()
				.mockResolvedValueOnce([{ insertId: 10 }]) // INSERT action
				.mockResolvedValueOnce([{ affectedRows: 1 }]), // UPDATE users
			commit: jest.fn(),
			rollback: jest.fn(),
			release: jest.fn(),
		}
		pool.getConnection = jest.fn().mockResolvedValue(mockConn)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/moderation/action`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						target_user_id: 2,
						action_type: 'WARNING',
						reason: 'First warning',
					}),
				}
			)
			expect(res.status).toBe(201)
			const body = await res.json()
			expect(body.action_type).toBe('WARNING')
			expect(body.target_user_id).toBe(2)
		})
		pool.getConnection.mockReset()
	})
})
