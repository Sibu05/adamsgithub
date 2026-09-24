import { WebSocketServer } from 'ws'
import pool from '../utils/db.js'
import { get_battle_state, list_battle_states } from './battle_state.js'

/* Read-only spectating. Spectators never touch the player message handler
 * in battle_socket.js — they only ever receive copies of the payloads the
 * two players are sent.
 *
 * battle_id -> Set<ws>
 */
const spectators = new Map()

// The only messages a spectator socket may send.
const SPECTATOR_MESSAGES = ['watch', 'leave', 'ping']

const CPU_NAME = 'CPU'

function send(ws, payload) {
	if (ws.readyState === 1)
		ws.send(
			typeof payload === 'string'
				? payload
				: JSON.stringify(payload)
		)
}

export function get_spectators(battle_id) {
	return spectators.get(battle_id) || new Set()
}

export function add_spectator(battle_id, ws) {
	remove_spectator(ws)
	if (!spectators.has(battle_id)) spectators.set(battle_id, new Set())
	spectators.get(battle_id).add(ws)
}

export function remove_spectator(ws) {
	for (const [battle_id, set] of spectators.entries()) {
		set.delete(ws)
		if (set.size === 0) spectators.delete(battle_id)
	}
}

export function clear_spectators(battle_id) {
	spectators.delete(battle_id)
}

/* Forward a (pre-serialised) player payload to everyone watching. */
export function broadcast_to_spectators(battle_id, payload) {
	const set = spectators.get(battle_id)
	if (!set) return
	for (const ws of set) {
		if (ws.readyState === 1) ws.send(payload)
		else if (ws.readyState > 1) set.delete(ws)
	}
}

/* { player1: { user_id, name }, player2: { user_id, name } } for a
 * battle state. player2_id === null means the NPC opponent.
 */
export async function get_player_names(state) {
	const ids = [state.player1_id, state.player2_id].filter(
		(id) => id !== null && id !== undefined
	)
	const names = new Map()
	if (ids.length) {
		const [rows] = await pool.query(
			'SELECT user_id, name FROM users WHERE user_id IN (?)',
			[ids]
		)
		for (const row of rows) names.set(row.user_id, row.name)
	}
	const describe = (id) => ({
		user_id: id,
		name:
			id === null || id === undefined
				? CPU_NAME
				: names.get(id) || `Player ${id}`,
	})
	return {
		player1: describe(state.player1_id),
		player2: describe(state.player2_id),
	}
}

export async function list_live_battles() {
	const battles = []
	for (const state of list_battle_states()) {
		const players = await get_player_names(state)
		const turn_owner =
			state.turn === state.player1_id
				? players.player1
				: players.player2
		battles.push({
			battle_id: state.battle_id,
			player1: players.player1,
			player2: players.player2,
			current_turn: turn_owner,
			turn_number: state.turn_number,
		})
	}
	return battles
}

export async function handle_spectator_message(ws, raw) {
	let msg
	try {
		msg = JSON.parse(raw)
	} catch {
		return send(ws, { type: 'error', message: 'Invalid JSON' })
	}

	if (!SPECTATOR_MESSAGES.includes(msg?.type)) {
		return send(ws, {
			type: 'error',
			reject_type: msg?.type,
			message: "Spectators can't play",
		})
	}

	if (msg.type === 'ping') return send(ws, { type: 'pong' })

	if (msg.type === 'leave') {
		remove_spectator(ws)
		return send(ws, { type: 'left' })
	}

	// watch
	const battle_id = Number(msg.battle_id)
	const state = get_battle_state(battle_id)
	if (!state) {
		remove_spectator(ws)
		return send(ws, { type: 'no_battle', battle_id })
	}

	add_spectator(battle_id, ws)
	const players = await get_player_names(state)
	send(ws, { type: 'state_update', battle_id, state, players })
}

export const spectateWss = new WebSocketServer({ noServer: true })

spectateWss.on('connection', (ws) => {
	ws.on('message', async (raw) => {
		try {
			await handle_spectator_message(ws, raw)
		} catch (err) {
			console.error('spectate socket error:', err)
			send(ws, { type: 'error', message: 'Server error' })
		}
	})
	ws.on('close', () => remove_spectator(ws))
})
