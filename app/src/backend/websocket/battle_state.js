import pool from '../utils/db.js'
import { BATTLE_DECK_NO_CARDS } from '../utils/battle.js'

const battle_states = new Map()

export async function load_battle_state(battle_id) {
	if (battle_states.has(battle_id)) {
		return battle_states.get(battle_id)
	}

	const [[battle]] = await pool.query(
		'SELECT * FROM battles WHERE battle_id = ?',
		[battle_id]
	)
	if (!battle) return null

	const [rows] = await pool.query(
		`SELECT bd.deck_id, bd.user_id, bd.card_id, bd.slot_position,
		        c.name, c.image_url, c.category, c.rarity, c.stat_attack, c.stat_location, c.stat_influence, c.stat_legacy, c.stat_era
		 FROM battle_decks bd
		 JOIN cards c ON c.card_id = bd.card_id
		 WHERE bd.battle_id = ?
		 ORDER BY bd.user_id, bd.slot_position`,
		[battle_id]
	)

	const state = {
		battle_id,
		status: battle.status,
		turn: battle.player1_id,
		turn_number: 1,
		player1_id: battle.player1_id,
		player2_id: battle.player2_id,
		cards: { player1: [], player2: [] },
	}

	for (const row of rows) {
		const card = {
			deck_id: row.deck_id,
			slot_position: row.slot_position,
			card_id: row.card_id,
			name: row.name,
			image_url: row.image_url,
			category: row.category,
			rarity: row.rarity,
			health: row.stat_legacy,
			ability_cooldown: 0,
			stat_attack: row.stat_attack,
			stat_location: row.stat_location,
			stat_influence: row.stat_influence,
			stat_legacy: row.stat_legacy,
			stat_era: row.stat_era,
			effects: [],
		}
		if (row.user_id === battle.player1_id)
			state.cards.player1.push(card)
		else state.cards.player2.push(card)
	}
	if (
		state.cards.player1.length != BATTLE_DECK_NO_CARDS ||
		state.cards.player2.length != BATTLE_DECK_NO_CARDS
	)
		return null

	battle_states.set(battle_id, state)
	return state
}

export function get_battle_state(battle_id) {
	return battle_states.get(battle_id) || null
}

export function clear_battle_state(battle_id) {
	battle_states.delete(battle_id)
}
