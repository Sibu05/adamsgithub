import { jest } from '@jest/globals'

// Mock the shared pool before any battle module imports it. Queries are
// dispatched by SQL shape so the real battle_socket / battle_state code
// runs end to end against canned rows.
jest.unstable_mockModule('../utils/db.js', () => ({
	default: {
		query: jest.fn(),
	},
}))

const { default: pool } = await import('../utils/db.js')
const { load_battle_state, get_battle_state } =
	await import('./battle_state.js')
const {
	get_spectators,
	add_spectator,
	broadcast_to_spectators,
	handle_spectator_message,
} = await import('./spectate_socket.js')
const { setup_websocket_router } = await import('./socket_router.js')

import { createServer } from 'http'
import WebSocket from 'ws'

// ── Fixtures ────────────────────────────────────────────────

const BATTLE_ID = 7
const PLAYER_ID = 1

function makeCard(deck_id, user_id, slot_position) {
	return {
		deck_id,
		user_id,
		card_id: deck_id,
		slot_position,
		name: `Card ${deck_id}`,
		image_url: '',
		category: 'CHARACTER',
		rarity: 'COMMON',
		stat_attack: 10,
		stat_location: 10,
		stat_influence: 10,
		stat_legacy: 500,
		stat_era: 2000,
	}
}

const deck_rows = [
	...[0, 1, 2, 3, 4].map((slot) => makeCard(slot + 1, PLAYER_ID, slot)),
	...[0, 1, 2, 3, 4].map((slot) => makeCard(slot + 11, null, slot)),
]

function dispatch(sql, params) {
	const q = String(sql).trim().toLowerCase().replace(/\s+/g, ' ')
	if (q.startsWith('select * from battles where battle_id')) {
		return [
			[
				{
					battle_id: BATTLE_ID,
					status: 'ACTIVE',
					player1_id: PLAYER_ID,
					player2_id: null,
				},
			],
		]
	}
	if (q.startsWith('select bd.deck_id')) return [deck_rows]
	// Only PLAYER_ID is in a battle; everyone else lands in the lobby.
	if (q.startsWith('select battle_id from battles where (player1_id'))
		return [
			params[0] === PLAYER_ID
				? [{ battle_id: BATTLE_ID }]
				: [],
		]
	if (q.startsWith('select user_id, name from users'))
		return [[{ user_id: PLAYER_ID, name: 'Alice' }]]
	return [{ affectedRows: 1, insertId: 1 }]
}

// ── Test harness ────────────────────────────────────────────

// Stand-in for express-session: the test client picks its user via a
// header, the real router still enforces "must have a user_id".
function fakeSession(req, _res, next) {
	const id = Number(req.headers['x-test-user'])
	req.session = id ? { user: { user_id: id, name: `User ${id}` } } : {}
	next()
}

let server
let base_url

function connect(path, user_id) {
	const ws = new WebSocket(`${base_url}${path}`, {
		headers: { 'x-test-user': String(user_id) },
	})
	ws.inbox = []
	ws.waiters = []
	ws.on('message', (raw) => {
		const msg = JSON.parse(raw)
		const idx = ws.waiters.findIndex((w) => w.type === msg.type)
		if (idx >= 0) ws.waiters.splice(idx, 1)[0].resolve(msg)
		else ws.inbox.push(msg)
	})
	return new Promise((resolve, reject) => {
		ws.on('open', () => resolve(ws))
		ws.on('error', reject)
	})
}

function next_message(ws, type) {
	const idx = ws.inbox.findIndex((m) => m.type === type)
	if (idx >= 0) return Promise.resolve(ws.inbox.splice(idx, 1)[0])
	return new Promise((resolve) => ws.waiters.push({ type, resolve }))
}

function sendJSON(ws, msg) {
	ws.send(JSON.stringify(msg))
}

async function waitUntil(check) {
	for (let i = 0; i < 100; i++) {
		if (check()) return
		await new Promise((r) => setTimeout(r, 10))
	}
	throw new Error('condition not met in time')
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => {})
	pool.query.mockImplementation(async (sql, params) =>
		dispatch(sql, params)
	)
	await load_battle_state(BATTLE_ID)

	server = createServer()
	await setup_websocket_router(server, fakeSession)
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	base_url = `ws://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve))
	console.log.mockRestore()
})

// ── Tests ───────────────────────────────────────────────────

describe('spectate socket', () => {
	test('rejects connections without a session', async () => {
		await expect(connect('/ws/spectate', 0)).rejects.toThrow(/401/)
	})

	test('watching a non-live battle returns no_battle', async () => {
		const spec = await connect('/ws/spectate', 2)
		sendJSON(spec, { type: 'watch', battle_id: 999 })
		const msg = await next_message(spec, 'no_battle')
		expect(msg.battle_id).toBe(999)
		expect(get_spectators(999).size).toBe(0)
		spec.close()
	})

	test('watching a live battle sends the current state and player names', async () => {
		const spec = await connect('/ws/spectate', 2)
		sendJSON(spec, { type: 'watch', battle_id: BATTLE_ID })
		const msg = await next_message(spec, 'state_update')
		expect(msg.battle_id).toBe(BATTLE_ID)
		expect(msg.state.cards.player1).toHaveLength(5)
		expect(msg.players).toEqual({
			player1: { user_id: PLAYER_ID, name: 'Alice' },
			player2: { user_id: null, name: 'CPU' },
		})
		expect(get_spectators(BATTLE_ID).size).toBe(1)
		spec.close()
		await waitUntil(() => get_spectators(BATTLE_ID).size === 0)
	})

	test("spectator can't attack, forfeit or submit a deck", async () => {
		const spec = await connect('/ws/spectate', 2)
		sendJSON(spec, { type: 'watch', battle_id: BATTLE_ID })
		await next_message(spec, 'state_update')

		const before = JSON.stringify(get_battle_state(BATTLE_ID))
		pool.query.mockClear()

		for (const type of ['attack', 'forfeit', 'submit_deck']) {
			sendJSON(spec, {
				type,
				battle_id: BATTLE_ID,
				attacker_slot: 0,
				target_slot: 0,
				action: 'ATTACK',
				deck: [],
			})
			const err = await next_message(spec, 'error')
			expect(err.message).toBe("Spectators can't play")
			expect(err.reject_type).toBe(type)
		}

		expect(JSON.stringify(get_battle_state(BATTLE_ID))).toBe(before)
		expect(pool.query).not.toHaveBeenCalled()
		spec.close()
		await waitUntil(() => get_spectators(BATTLE_ID).size === 0)
	})

	test('spectators receive turn_result, and match_results clears them', async () => {
		const player = await connect('/ws/battle', PLAYER_ID)
		sendJSON(player, { type: 'join_lobby' })
		await next_message(player, 'state_update')

		const spec = await connect('/ws/spectate', 2)
		sendJSON(spec, { type: 'watch', battle_id: BATTLE_ID })
		await next_message(spec, 'state_update')

		sendJSON(player, {
			type: 'attack',
			attacker_slot: 0,
			target_slot: 0,
			action: 'ATTACK',
		})
		const player_turn = await next_message(player, 'turn_result')
		const spec_turn = await next_message(spec, 'turn_result')
		expect(spec_turn).toEqual(player_turn)
		expect(spec_turn.battle_id).toBe(BATTLE_ID)
		expect(spec_turn.player_result.action).toBe('ATTACK')

		sendJSON(player, { type: 'forfeit' })
		const result = await next_message(spec, 'match_results')
		expect(result.winner).toBeNull()
		expect(get_spectators(BATTLE_ID).size).toBe(0)
		expect(get_battle_state(BATTLE_ID)).toBeNull()

		player.close()
		spec.close()
	})

	test('closed spectator sockets are removed', async () => {
		await load_battle_state(BATTLE_ID)
		const a = await connect('/ws/spectate', 2)
		const b = await connect('/ws/spectate', 3)
		sendJSON(a, { type: 'watch', battle_id: BATTLE_ID })
		sendJSON(b, { type: 'watch', battle_id: BATTLE_ID })
		await next_message(a, 'state_update')
		await next_message(b, 'state_update')
		expect(get_spectators(BATTLE_ID).size).toBe(2)

		a.close()
		await waitUntil(() => get_spectators(BATTLE_ID).size === 1)
		b.close()
		await waitUntil(() => get_spectators(BATTLE_ID).size === 0)
	})
})

describe('spectate helpers', () => {
	function fakeWs(readyState = 1) {
		return { readyState, send: jest.fn() }
	}

	test('broadcast skips and prunes closed sockets', () => {
		const open = fakeWs(1)
		const closed = fakeWs(3)
		add_spectator(42, open)
		add_spectator(42, closed)

		broadcast_to_spectators(42, '{"type":"turn_result"}')

		expect(open.send).toHaveBeenCalledWith('{"type":"turn_result"}')
		expect(closed.send).not.toHaveBeenCalled()
		expect(get_spectators(42).has(closed)).toBe(false)
	})

	test('ping, leave and invalid JSON', async () => {
		const ws = fakeWs()
		const sent = () => JSON.parse(ws.send.mock.calls.at(-1)[0])

		await handle_spectator_message(ws, 'not json')
		expect(sent()).toEqual({
			type: 'error',
			message: 'Invalid JSON',
		})

		await handle_spectator_message(ws, '{"type":"ping"}')
		expect(sent()).toEqual({ type: 'pong' })

		add_spectator(43, ws)
		await handle_spectator_message(ws, '{"type":"leave"}')
		expect(sent()).toEqual({ type: 'left' })
		expect(get_spectators(43).size).toBe(0)
	})
})

// Spectating piggybacks on the player socket, so these pin down the player
// side's existing guards that the spectator tests rely on staying intact.
describe('battle socket guards', () => {
	async function lastError(ws, msg) {
		sendJSON(ws, msg)
		return (await next_message(ws, 'error')).message
	}

	test('lobby player: ping, bad JSON, unknown and out-of-battle messages', async () => {
		const lobby = await connect('/ws/battle', 5)
		sendJSON(lobby, { type: 'ping' })
		await next_message(lobby, 'pong')

		lobby.send('not json')
		expect((await next_message(lobby, 'error')).message).toBe(
			'Invalid JSON'
		)

		sendJSON(lobby, { type: 'join_lobby' })
		await next_message(lobby, 'lobby_users')

		expect(await lastError(lobby, { type: 'dance' })).toBe(
			'Unknown message type: dance'
		)
		expect(await lastError(lobby, { type: 'attack' })).toBe(
			'Join a battle first'
		)
		expect(await lastError(lobby, { type: 'forfeit' })).toBe(
			'Join a battle first'
		)
		expect(await lastError(lobby, { type: 'submit_deck' })).toBe(
			'Not currently in an active battle'
		)
		expect(
			await lastError(lobby, {
				type: 'challenge_player',
				target_user_id: null,
			})
		).toBe('Target user id invalid')
		expect(
			await lastError(lobby, {
				type: 'challenge_player',
				target_user_id: 404,
			})
		).toBe('Player is unavailable or offline')
		lobby.close()
	})

	test('challenge then reject returns both players to the lobby', async () => {
		const a = await connect('/ws/battle', 5)
		const b = await connect('/ws/battle', 6)
		sendJSON(a, { type: 'join_lobby' })
		sendJSON(b, { type: 'join_lobby' })
		await next_message(a, 'lobby_users')
		await next_message(b, 'lobby_users')

		sendJSON(a, { type: 'challenge_player', target_user_id: 6 })
		const invite = await next_message(b, 'incoming_challenge')
		expect(invite.from_user_id).toBe(5)
		expect(
			await lastError(a, {
				type: 'challenge_player',
				target_user_id: 6,
			})
		).toBe('Already in battle')

		sendJSON(b, {
			type: 'accept_challenge',
			accept: false,
			challenger_id: 5,
		})
		await next_message(a, 'reject_challenge')
		a.close()
		b.close()
	})

	test('player attack validation leaves the spectated state alone', async () => {
		await load_battle_state(BATTLE_ID)
		const player = await connect('/ws/battle', PLAYER_ID)
		sendJSON(player, { type: 'join_lobby' })
		await next_message(player, 'state_update')
		const before = JSON.stringify(get_battle_state(BATTLE_ID))

		const attack = (extra) =>
			lastError(player, {
				type: 'attack',
				attacker_slot: 0,
				target_slot: 0,
				action: 'ATTACK',
				...extra,
			})
		expect(await attack({ attacker_slot: 99 })).toBe(
			'No card in that slot'
		)
		expect(await attack({ target_slot: 99 })).toBe(
			'No opponent card in that slot'
		)
		expect(await attack({ action: 'BUFF' })).toBe(
			"CHARACTER cards can't BUFF"
		)
		expect(JSON.stringify(get_battle_state(BATTLE_ID))).toBe(before)

		// Forfeit so closing doesn't arm the 2-minute abandon timer.
		sendJSON(player, { type: 'forfeit' })
		await next_message(player, 'match_results')
		player.close()
	})
})
