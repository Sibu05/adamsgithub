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

// A tiny in-memory DB that enforces the REAL foreign keys on
// trivia_questions (fk_option_question, fk_ta_question, fk_otq_question —
// none cascade). The old route deleted the question row directly; that
// passed against a plain mock but fails here exactly like MySQL did
// (ER_ROW_IS_REFERENCED_2 / errno 1451).
function makeFkDb({
	questions = [],
	options = {},
	attempts = {},
	offline = {},
}) {
	const state = {
		questions: new Set(questions),
		options: { ...options },
		attempts: { ...attempts },
		offline: { ...offline },
		committed: false,
		rolledBack: false,
		log: [],
	}
	const conn = {
		beginTransaction: jest.fn(async () => {}),
		commit: jest.fn(async () => {
			state.committed = true
		}),
		rollback: jest.fn(async () => {
			state.rolledBack = true
		}),
		release: jest.fn(),
		query: jest.fn(async (sql, params = []) => {
			const q = sql.replace(/\s+/g, ' ').trim()
			const id = Number(params[0])
			state.log.push(q.split(' WHERE')[0])
			if (
				q.startsWith(
					'SELECT question_id FROM trivia_questions'
				)
			)
				return [
					state.questions.has(id)
						? [{ question_id: id }]
						: [],
				]
			if (q.includes('FROM trivia_attempts'))
				return [
					[
						{
							answered:
								(state.attempts[
									id
								] || 0) +
								(state.offline[
									id
								] || 0),
						},
					],
				]
			if (q.startsWith('DELETE FROM trivia_options')) {
				const n = state.options[id] || 0
				state.options[id] = 0
				return [{ affectedRows: n }]
			}
			if (q.startsWith('DELETE FROM trivia_questions')) {
				if (
					state.options[id] ||
					state.attempts[id] ||
					state.offline[id]
				) {
					const err = new Error(
						'Cannot delete or update a parent row: a foreign key constraint fails'
					)
					err.code = 'ER_ROW_IS_REFERENCED_2'
					err.errno = 1451
					throw err
				}
				const had = state.questions.delete(id)
				return [{ affectedRows: had ? 1 : 0 }]
			}
			return [[]]
		}),
	}
	// Anything run straight on the pool sees the same FK rules.
	pool.query.mockImplementation(async (sql, params) => {
		if (String(sql).includes('FROM admin_roles'))
			return [[{ 1: 1 }]]
		return conn.query(sql, params)
	})
	pool.getConnection.mockResolvedValue(conn)
	return { conn, state }
}

describe('DELETE /api/questions/:id', () => {
	beforeEach(() => {
		pool.query.mockReset()
		pool.getConnection.mockReset()
	})

	function del(base, id) {
		return fetch(`${base}/api/questions/${id}`, {
			method: 'DELETE',
		})
	}

	test('the fake DB rejects deleting a question that still has options (as MySQL does)', async () => {
		const { conn } = makeFkDb({ questions: [1], options: { 1: 4 } })
		await expect(
			conn.query(
				'DELETE FROM trivia_questions WHERE question_id = ?',
				[1]
			)
		).rejects.toMatchObject({ errno: 1451 })
	})

	test('200 deletes a question WITH options: options first, then the question, committed', async () => {
		const { state } = makeFkDb({
			questions: [1],
			options: { 1: 4 },
		})
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			const res = await del(base, 1)
			expect(res.status).toBe(200)
		})
		expect(state.questions.has(1)).toBe(false)
		expect(state.options[1]).toBe(0)
		expect(state.committed).toBe(true)
		const iOpts = state.log.indexOf('DELETE FROM trivia_options')
		const iQ = state.log.indexOf('DELETE FROM trivia_questions')
		expect(iOpts).toBeGreaterThanOrEqual(0)
		expect(iOpts).toBeLessThan(iQ)
	})

	test('404 when not found', async () => {
		const { state } = makeFkDb({ questions: [] })
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			const res = await del(base, 999)
			expect(res.status).toBe(404)
		})
		expect(state.committed).toBe(false)
	})

	test('409 (not 500) when players have already answered it; nothing is deleted', async () => {
		const { state } = makeFkDb({
			questions: [2],
			options: { 2: 2 },
			attempts: { 2: 3 },
		})
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			const res = await del(base, 2)
			expect(res.status).toBe(409)
			expect((await res.json()).error).toMatch(
				/already answered/
			)
		})
		expect(state.questions.has(2)).toBe(true)
		expect(state.options[2]).toBe(2)
		expect(state.committed).toBe(false)
	})

	test('409 also covers queued offline attempts', async () => {
		const { state } = makeFkDb({
			questions: [3],
			offline: { 3: 1 },
		})
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			expect((await del(base, 3)).status).toBe(409)
		})
		expect(state.questions.has(3)).toBe(true)
	})

	test('500 rolls back and releases the connection on a DB error', async () => {
		const { conn, state } = makeFkDb({ questions: [4] })
		const original = conn.query.getMockImplementation()
		conn.query.mockImplementation(async (sql, params) => {
			if (sql.startsWith('DELETE FROM trivia_options'))
				throw new Error('boom')
			return original(sql, params)
		})
		await withServer(makeApp({ user_id: 1 }), async (base) => {
			expect((await del(base, 4)).status).toBe(500)
		})
		expect(state.rolledBack).toBe(true)
		expect(conn.release).toHaveBeenCalled()
	})

	test('403 for a non-author', async () => {
		pool.query.mockResolvedValueOnce([[]])
		await withServer(makeApp({ user_id: 5 }), async (base) => {
			expect((await del(base, 1)).status).toBe(403)
		})
	})
})
