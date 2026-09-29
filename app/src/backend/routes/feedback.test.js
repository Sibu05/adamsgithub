import { jest } from '@jest/globals'
jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))
const { default: pool } = await import('../utils/db.js')
const { default: feedbackRouter } = await import('./feedback.js')
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
	app.use('/api/feedback', feedbackRouter)
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

const sampleRow = {
	report_id: 7,
	user_id: 2,
	name: 'Bob van Wyk',
	email: 'bob@example.com',
	category: 'BUG',
	title: 'Map froze on campus',
	body: 'Pins stopped loading near Great Hall.',
	status: 'NEW',
	admin_note: null,
	created_at: '2026-09-01T10:00:00Z',
	updated_at: '2026-09-01T10:00:00Z',
}

describe('POST /api/feedback', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: 'x',
					body: 'y',
				}),
			})
			expect(res.status).toBe(401)
		})
	})
	test('400 on bad category / missing fields', async () => {
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const post = (payload) =>
				fetch(`${base}/api/feedback`, {
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify(payload),
				})
			expect(
				(
					await post({
						category: 'NOPE',
						title: 't',
						body: 'b',
					})
				).status
			).toBe(400)
			expect(
				(await post({ title: '', body: 'b' })).status
			).toBe(400)
			expect(
				(await post({ title: 't', body: '' })).status
			).toBe(400)
		})
	})
	test('201 creates and returns the report', async () => {
		pool.query
			.mockResolvedValueOnce([{ insertId: 7 }])
			.mockResolvedValueOnce([[sampleRow]])
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					category: 'bug',
					title: 'Map froze on campus',
					body: 'Pins stopped loading near Great Hall.',
				}),
			})
			expect(res.status).toBe(201)
			const data = await res.json()
			expect(data.report_id).toBe(7)
			expect(data.status).toBe('NEW')
		})
	})
})

describe('GET /api/feedback/mine', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback/mine`)
			expect(res.status).toBe(401)
		})
	})
	test('200 returns only my reports', async () => {
		pool.query.mockResolvedValueOnce([[[sampleRow]].flat()])
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback/mine`)
			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data).toHaveLength(1)
			expect(pool.query.mock.calls[0][1]).toEqual([2])
		})
	})
})

describe('GET /api/feedback (admin)', () => {
	beforeEach(() => pool.query.mockReset())
	test('403 when not admin', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback`)
			expect(res.status).toBe(403)
		})
	})
	test('200 lists all reports for admins', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[sampleRow]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback`)
			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data[0].title).toBe('Map froze on campus')
		})
	})
	test('400 on invalid status filter', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/feedback?status=BOGUS`
			)
			expect(res.status).toBe(400)
		})
	})
})

describe('PATCH /api/feedback/:id (admin)', () => {
	beforeEach(() => pool.query.mockReset())
	test('403 when not admin', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 2 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback/7`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'RESOLVED' }),
			})
			expect(res.status).toBe(403)
		})
	})
	test('400 on invalid status, 404 when missing', async () => {
		const app = makeApp({ user_id: 1 })
		pool.query.mockResolvedValue({ rows: [] })
		pool.query.mockReset()
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		await withServer(app, async (base) => {
			const bad = await fetch(`${base}/api/feedback/7`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'NOPE' }),
			})
			expect(bad.status).toBe(400)
		})
		pool.query.mockReset()
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ affectedRows: 0 }])
		await withServer(app, async (base) => {
			const missing = await fetch(
				`${base}/api/feedback/999`,
				{
					method: 'PATCH',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						status: 'RESOLVED',
					}),
				}
			)
			expect(missing.status).toBe(404)
		})
	})
	test('200 updates status and note', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([
				[{ ...sampleRow, status: 'ACKNOWLEDGED' }],
			])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/feedback/7`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'acknowledged',
					admin_note: 'Looking into it.',
				}),
			})
			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data.status).toBe('ACKNOWLEDGED')
		})
	})
})
