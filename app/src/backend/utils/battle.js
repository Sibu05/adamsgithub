import pool from './db.js'

export const TURN_TIMEOUT_MS = 32 * 1000
export const BATTLE_DECK_NO_CARDS = 5

export async function valid_user_cards(user, deck) {
	if (!Array.isArray(deck) || deck.length != BATTLE_DECK_NO_CARDS)
		return false

	const card_ids = deck.map((c) => c.card_id)
	const placeholders = card_ids.map(() => '?').join(',')
	const values = [...card_ids, user.user_id]

	// Fetch rarity alongside ownership — needed for the deck constraint
	// below, not just the ownership check.
	const [rows] = await pool.query(
		`SELECT uc.card_id, c.rarity
           FROM user_cards uc
           JOIN cards c ON c.card_id = uc.card_id
          WHERE uc.card_id IN (${placeholders}) AND uc.user_id = ?`,
		values
	)

	// Ownership check — every submitted card_id must resolve back to a row
	// this player owns. (Equivalent to the old COUNT(DISTINCT ...) check,
	// since the frontend already prevents duplicate card_ids in one deck.)
	if (rows.length !== card_ids.length) return false

	// Deck constraint (user story 8): at most 1 LEGENDARY card per deck —
	// stops a player from stacking an all-Legendary deck just because they
	// happen to own that many.
	const legendaryCount = rows.filter(
		(r) => r.rarity === 'LEGENDARY'
	).length
	if (legendaryCount > 1) return false

	return true
}

export async function get_active_battle(user_id) {
	try {
		const [rows, fields] = await pool.query(
			`SELECT battle_id FROM battles WHERE (player1_id = ? OR player2_id = ?) AND status = 'ACTIVE' LIMIT 1`,
			[user_id, user_id]
		)

		if (rows.length == 0) return null
		else return rows[0].battle_id
	} catch {
		return null
	}
}

export async function abandon_battle(battle_id) {
	try {
		const [rows, fields] = await pool.query(
			`UPDATE battles SET status = 'ABANDONED', winner_id = ?, ended_at = NOW() WHERE battle_id = ?`,
			[null, battle_id]
		)

		if (rows.length == 0) return null
		else return rows[0].affectedRows
	} catch {
		return false
	}
}

export async function abandon_stale_battles() {
	try {
		const [result] = await pool.query(
			`UPDATE battles
			 SET status = 'ABANDONED', winner_id = NULL, ended_at = NOW()
			 WHERE status IN ('PENDING', 'ACTIVE')`
		)
		console.log(
			`[Server Startup] Cleaned up ${result.affectedRows} unresolved battle(s).`
		)
		return result.affectedRows
	} catch (err) {
		console.error(
			'[Server Startup] Error abandoning stale battles:',
			err
		)
		throw err
	}
}
