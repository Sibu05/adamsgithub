import { jest } from '@jest/globals'
jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))
const { default: pool } = await import('../utils/db.js')
const { default: qRouter } = await import('./questions.js')
import express from 'express'
import { createServer } from 'http'
function makeApp(user = { user_id: 1 }) {
	const s = user ? { user } : {}
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = s
		req.user = user
		next()
	})
	app.use('/api', qRouter)
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
function makeConn() {
	return {
		beginTransaction: jest.fn(),
		commit: jest.fn(),
		rollback: jest.fn(),
		release: jest.fn(),
		query: jest.fn(async () => [{ insertId: 10, affectedRows: 1 }]),
	}
}

describe('GET /api/events/:eventId/questions', () => {
	beforeEach(() => pool.query.mockReset())
	test('200 returns questions with options array', async () => {
		pool.query
			.mockResolvedValueOnce([
				[
					{
						id: 1,
						event_id: 1,
						type: 'MULTIPLE_CHOICE',
						text: 'Q?',
					},
				],
			])
			.mockResolvedValueOnce([
				[
					{ option_id: 1, body: 'A' },
					{ option_id: 2, body: 'B' },
				],
			])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body[0].options).toEqual(['A', 'B'])
		})
	})
	test('200 never leaks a FILL_BLANK answer (public route)', async () => {
		pool.query.mockResolvedValueOnce([
			[
				{
					id: 3,
					event_id: 1,
					type: 'FILL_BLANK',
					text: 'Wits was founded in ____.',
				},
			],
		])
		// If the route queried trivia_options it would get the answer.
		pool.query.mockResolvedValue([[{ option_id: 9, body: '1922' }]])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body[0].options).toBeNull()
			expect(JSON.stringify(body)).not.toContain('1922')
		})
		expect(pool.query).toHaveBeenCalledTimes(1)
	})
	test('200 empty when no questions', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`
			)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual([])
		})
	})
})

describe('POST /api/events/:eventId/questions', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})
	test('401 when no auth', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'MULTIPLE_CHOICE',
						text: 'Q',
						correctAnswer: 'A',
						options: ['A'],
					}),
				}
			)
			expect(res.status).toBe(401)
		})
	})
	test('403 when not author', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'MULTIPLE_CHOICE',
						text: 'Q',
						correctAnswer: 'A',
						options: ['A'],
					}),
				}
			)
			expect(res.status).toBe(403)
		})
	})
	test('400 validation: bad type', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'BAD',
						text: 'Q',
						correctAnswer: 'A',
					}),
				}
			)
			expect(res.status).toBe(400)
		})
	})
	test('400 MULTIPLE_CHOICE needs correctAnswer in options', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'MULTIPLE_CHOICE',
						text: 'Q',
						correctAnswer: 'C',
						options: ['A', 'B'],
					}),
				}
			)
			expect(res.status).toBe(400)
		})
	})
	test('400 TRUE_FALSE needs true/false', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'TRUE_FALSE',
						text: 'Q',
						correctAnswer: 'maybe',
					}),
				}
			)
			expect(res.status).toBe(400)
		})
	})
	test('404 when event not found', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // author
			.mockResolvedValueOnce([[]]) // event check
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/999/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'FILL_BLANK',
						text: 'Q',
						correctAnswer: 'ans',
					}),
				}
			)
			expect(res.status).toBe(404)
		})
	})
	test('201 creates MULTIPLE_CHOICE', async () => {
		const conn = makeConn()
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // author
			.mockResolvedValueOnce([[{ event_id: 1 }]]) // event exists
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'MULTIPLE_CHOICE',
						text: 'Q',
						correctAnswer: 'A',
						options: ['A', 'B'],
					}),
				}
			)
			expect(res.status).toBe(201)
		})
		expect(conn.query).toHaveBeenCalled()
	})
	test('201 creates TRUE_FALSE', async () => {
		const conn = makeConn()
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[{ event_id: 1 }]])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'TRUE_FALSE',
						text: 'Q?',
						correctAnswer: 'true',
					}),
				}
			)
			expect(res.status).toBe(201)
		})
	})
	test('201 creates FILL_BLANK', async () => {
		const conn = makeConn()
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[{ event_id: 1 }]])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/events/1/questions`,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						type: 'FILL_BLANK',
						text: 'Q __',
						correctAnswer: 'ans',
					}),
				}
			)
			expect(res.status).toBe(201)
		})
	})
})

describe('PUT /api/questions/:id', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})
	test('404 when not found', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // author
			.mockResolvedValueOnce([[]]) // existing check
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/questions/999`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'FILL_BLANK',
					text: 'Q',
					correctAnswer: 'a',
				}),
			})
			expect(res.status).toBe(404)
		})
	})
	test('200 updates', async () => {
		const conn = makeConn()
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[{ question_id: 1 }]])
		pool.getConnection.mockResolvedValue(conn)
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/questions/1`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'FILL_BLANK',
					text: 'Q',
					correctAnswer: 'a',
				}),
			})
			expect(res.status).toBe(200)
		})
	})
})

describe('DELETE /api/questions/:id', () => {
	beforeEach(() => pool.query.mockReset())
	test('404 when not found', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // author
			.mockResolvedValueOnce([{ affectedRows: 0 }]) // delete
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/questions/999`, {
				method: 'DELETE',
			})
			expect(res.status).toBe(404)
		})
	})
	test('200 deletes', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/questions/1`, {
				method: 'DELETE',
			})
			expect(res.status).toBe(200)
		})
	})
})
