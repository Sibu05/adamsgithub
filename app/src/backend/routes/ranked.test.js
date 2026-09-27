import { jest } from '@jest/globals'

jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { default: ranked_router } = await import('./ranked.js')

import express from 'express'
import { createServer } from 'http'

// ── Test harness (same shape as battles.test.js) ────────────

function makeApp(sessionUser = { user_id: 1 }) {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.user = sessionUser
		req.session = sessionUser ? { user: sessionUser } : {}
		next()
	})
	app.use('/api/ranked', ranked_router)
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

// ── Fixture state, mutated per-test ──────────────────────────

let state

function dispatch(sql, params) {
	const q = String(sql).trim().toLowerCase().replace(/\s+/g, ' ')

	if (q.startsWith('select * from seasons'))
		return [state.season ? [state.season] : []]

	if (
		q.startsWith(
			'select rating, wins, losses from leaderboard_entries'
		)
	)
		return [state.entry ? [state.entry] : []]

	if (q.startsWith('select le.user_id, le.rating, u.name'))
		return [state.opponents || []]

	throw new Error(`Unexpected query: ${q}`)
}

beforeEach(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {})
	state = {
		season: { season_id: 1, name: 'Season 1', is_active: true },
		entry: null,
		opponents: [],
	}
	pool.query.mockReset()
	pool.query.mockImplementation(async (sql, params) =>
		dispatch(sql, params)
	)
})

afterEach(() => {
	console.log.mockRestore()
})

// ── GET /api/ranked/season ───────────────────────────────────

describe('GET /api/ranked/season', () => {
	test('returns the active season (public — no auth required)', async () => {
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/ranked/season`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				season: state.season,
			})
		})
	})

	test('returns null when no season is active', async () => {
		state.season = null
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/ranked/season`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ season: null })
		})
	})

	test('500 when the query fails', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {})
		pool.query.mockRejectedValue(new Error('db down'))
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/ranked/season`)
			expect(res.status).toBe(500)
		})
		console.error.mockRestore()
	})
})

// ── GET /api/ranked/me ────────────────────────────────────────

describe('GET /api/ranked/me', () => {
	test('401 when not logged in', async () => {
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/ranked/me`)
			expect(res.status).toBe(401)
		})
	})

	test('rating and season are null when no season is active', async () => {
		state.season = null
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/ranked/me`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				rating: null,
				season: null,
			})
		})
	})

	test('returns the existing entry for the logged-in user', async () => {
		state.entry = { rating: 1120, wins: 4, losses: 1 }
		await withServer(makeApp({ user_id: 10 }), async (url) => {
			const res = await fetch(`${url}/api/ranked/me`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				season_id: 1,
				rating: 1120,
				wins: 4,
				losses: 1,
			})
		})
	})

	test('defaults to 1000/0/0 when the season is active but the user has no entry yet', async () => {
		state.entry = null
		await withServer(makeApp({ user_id: 10 }), async (url) => {
			const res = await fetch(`${url}/api/ranked/me`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				season_id: 1,
				rating: 1000,
				wins: 0,
				losses: 0,
			})
		})
	})

	test('500 when the query fails', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {})
		pool.query.mockRejectedValue(new Error('db down'))
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/ranked/me`)
			expect(res.status).toBe(500)
		})
		console.error.mockRestore()
	})
})

// ── GET /api/ranked/opponents ────────────────────────────────

describe('GET /api/ranked/opponents', () => {
	test('401 when not logged in', async () => {
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/ranked/opponents`)
			expect(res.status).toBe(401)
		})
	})

	test('empty list when no season is active', async () => {
		state.season = null
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/ranked/opponents`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ opponents: [] })
		})
	})

	test("returns same-band opponents using the caller's rating", async () => {
		state.entry = { rating: 1050, wins: 2, losses: 0 }
		state.opponents = [
			{ user_id: 20, rating: 1100, name: 'Bob' },
			{ user_id: 30, rating: 950, name: 'Carol' },
		]
		await withServer(makeApp({ user_id: 10 }), async (url) => {
			const res = await fetch(`${url}/api/ranked/opponents`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				opponents: state.opponents,
				my_rating: 1050,
			})
		})
	})

	test('falls back to the default rating (1000) when the caller has no entry yet', async () => {
		state.entry = null
		state.opponents = [{ user_id: 20, rating: 980, name: 'Bob' }]
		await withServer(makeApp({ user_id: 10 }), async (url) => {
			const res = await fetch(`${url}/api/ranked/opponents`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.my_rating).toBe(1000)
		})
	})

	test('500 when the query fails', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {})
		pool.query.mockRejectedValue(new Error('db down'))
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/ranked/opponents`)
			expect(res.status).toBe(500)
		})
		console.error.mockRestore()
	})
})
