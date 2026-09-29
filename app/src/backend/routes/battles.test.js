import { jest } from '@jest/globals'

jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { load_battle_state, clear_battle_state } =
	await import('../websocket/battle_state.js')
const { default: battles_router } = await import('./battles.js')

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
	app.use('/api/battles', battles_router)
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

function deck(user_id, first_deck_id) {
	return [0, 1, 2, 3, 4].map((slot) => ({
		deck_id: first_deck_id + slot,
		user_id,
		card_id: 1,
		slot_position: slot,
		name: 'Card',
		image_url: '',
		category: 'CHARACTER',
		rarity: 'COMMON',
		stat_attack: 10,
		stat_location: 10,
		stat_influence: 10,
		stat_legacy: 50,
		stat_era: 2000,
	}))
}

// Two live battles: PvP (Alice vs Bob, battle 1) and NPC (Alice vs CPU, battle 2).
const battles = {
	1: { battle_id: 1, status: 'ACTIVE', player1_id: 10, player2_id: 20 },
	2: { battle_id: 2, status: 'ACTIVE', player1_id: 10, player2_id: null },
}
const decks = {
	1: [...deck(10, 100), ...deck(20, 200)],
	2: [...deck(10, 300), ...deck(null, 400)],
}

function dispatch(sql, params) {
	const q = String(sql).trim().toLowerCase().replace(/\s+/g, ' ')
	if (q.startsWith('select * from battles where battle_id'))
		return [[battles[params[0]]]]
	if (q.startsWith('select bd.deck_id')) return [decks[params[0]]]
	if (q.startsWith('select user_id, name from users'))
		return [
			[
				{ user_id: 10, name: 'Alice' },
				{ user_id: 20, name: 'Bob' },
			].filter((u) => params[0].includes(u.user_id)),
		]
	throw new Error(`Unexpected query: ${q}`)
}

beforeEach(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {})
	pool.query.mockReset()
	pool.query.mockImplementation(async (sql, params) =>
		dispatch(sql, params)
	)
	clear_battle_state(1)
	clear_battle_state(2)
})

afterEach(() => {
	console.log.mockRestore()
})

// ── Tests ───────────────────────────────────────────────────

describe('GET /api/battles/live', () => {
	test('401 when not logged in', async () => {
		await withServer(makeApp(null), async (url) => {
			const res = await fetch(`${url}/api/battles/live`)
			expect(res.status).toBe(401)
		})
	})

	test('empty list when nothing is live', async () => {
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/battles/live`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ battles: [] })
		})
	})

	test('lists live battles with names, CPU and turn owner', async () => {
		await load_battle_state(1)
		const npc = await load_battle_state(2)
		npc.turn = null // CPU's turn
		npc.turn_number = 3

		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/battles/live`)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.battles).toEqual([
				{
					battle_id: 1,
					player1: { user_id: 10, name: 'Alice' },
					player2: { user_id: 20, name: 'Bob' },
					current_turn: {
						user_id: 10,
						name: 'Alice',
					},
					turn_number: 1,
				},
				{
					battle_id: 2,
					player1: { user_id: 10, name: 'Alice' },
					player2: { user_id: null, name: 'CPU' },
					current_turn: {
						user_id: null,
						name: 'CPU',
					},
					turn_number: 3,
				},
			])
		})
	})

	test('500 when the name lookup fails', async () => {
		await load_battle_state(1)
		jest.spyOn(console, 'error').mockImplementation(() => {})
		pool.query.mockRejectedValue(new Error('db down'))
		await withServer(makeApp(), async (url) => {
			const res = await fetch(`${url}/api/battles/live`)
			expect(res.status).toBe(500)
		})
		console.error.mockRestore()
	})
})
