import express from 'express'

import pool from '../utils/db.js'
import { error, success } from '../utils/response.js'
import { RARITY_POINTS } from '../utils/rarity_points.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Trades Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

// ── Anti-abuse thresholds (user story 9) ────────────────────
//
// The brief specifies that anti-abuse rules must be "rule-based",
// not dependent on the trust-scoring engine (that's US3-04). These
// three are the concrete rules. They are deliberately conservative
// so a legitimate player never trips them.

// Maximum number of completed trades per user in a rolling 24h window.
const DAILY_TRADE_CAP = 5

// Maximum absolute difference in rarity value between the two cards
// being swapped. Uses RARITY_POINTS so a COMMON↔LEGENDARY trade
// (diff 75) is rejected, while a RARE↔EPIC (diff 20) is allowed.
const MAX_VALUE_ASYMMETRY = 20

// Minimum account age in seconds before a user can trade. Stops
// throwaway accounts from funnelling cards into a main account.
const MIN_ACCOUNT_AGE_S = 3600 // 1 hour

// ── Auth ────────────────────────────────────────────────────
function requireAuth(req, res, next) {
	if (!req.user?.user_id) {
		return error(res, 401, 'Unauthorised — please log in')
	}
	next()
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Fetch full card details (name, rarity, image) for a set of card_ids.
 * Returns a Map of card_id → card row, so callers can enrich trade rows
 * without N+1 queries.
 */
async function fetchCardMap(card_ids) {
	if (!card_ids.length) return new Map()
	const placeholders = card_ids.map(() => '?').join(',')
	const [rows] = await pool.query(
		`SELECT card_id, name, rarity, category, image_url
		   FROM cards WHERE card_id IN (${placeholders})`,
		card_ids
	)
	return new Map(rows.map((r) => [r.card_id, r]))
}

/**
 * Decorate a raw trade row with both cards' full details plus the two
 * players' display names. Used by all four list/detail endpoints.
 */
async function decorateTrade(trade, cardMap = null) {
	const cardIds = [trade.initiator_card_id, trade.receiver_card_id]
	const map = cardMap || (await fetchCardMap(cardIds))

	const [players] = await pool.query(
		`SELECT user_id, name, avatar_url
		   FROM users WHERE user_id IN (?, ?)`,
		[trade.initiator_id, trade.receiver_id]
	)
	const playerMap = new Map(players.map((p) => [p.user_id, p]))

	return {
		...trade,
		initiator_card: map.get(trade.initiator_card_id) || null,
		receiver_card: map.get(trade.receiver_card_id) || null,
		initiator: playerMap.get(trade.initiator_id) || null,
		receiver: playerMap.get(trade.receiver_id) || null,
	}
}

/**
 * Verify that a user currently owns at least one copy of the given card.
 * Returns false if the row is missing or quantity is 0.
 */
async function userOwnsCard(conn, user_id, card_id) {
	const [rows] = await conn.query(
		`SELECT quantity FROM user_cards
		  WHERE user_id = ? AND card_id = ?`,
		[user_id, card_id]
	)
	return rows.length > 0 && rows[0].quantity > 0
}

/**
 * Move one copy of a card from one user to another, inside the given
 * connection/transaction. Decrements the source row (deleting it if the
 * quantity hits zero) and upserts on the destination.
 */
async function transferCard(conn, from_user_id, to_user_id, card_id) {
	// Decrement source; delete the row entirely if it hits zero so the
	// UNIQUE(user_id, card_id) constraint doesn't leave empty rows around.
	await conn.query(
		`UPDATE user_cards SET quantity = quantity - 1
		  WHERE user_id = ? AND card_id = ?`,
		[from_user_id, card_id]
	)
	await conn.query(
		`DELETE FROM user_cards
		  WHERE user_id = ? AND card_id = ? AND quantity <= 0`,
		[from_user_id, card_id]
	)

	// Upsert on destination — first copy creates the row, later copies
	// bump quantity.
	await conn.query(
		`INSERT INTO user_cards (user_id, card_id, quantity)
		 VALUES (?, ?, 1)
		 ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
		[to_user_id, card_id]
	)
}

/**
 * Count completed (ACCEPTED) trades a user was party to in the last 24h.
 * Used to enforce the daily trade cap.
 */
async function tradesCompletedInLast24h(conn, user_id) {
	const [rows] = await conn.query(
		`SELECT COUNT(*) AS n FROM trades
		  WHERE status = 'ACCEPTED'
		    AND resolved_at >= (NOW() - INTERVAL 24 HOUR)
		    AND (initiator_id = ? OR receiver_id = ?)`,
		[user_id, user_id]
	)
	return rows[0].n
}

/**
 * Verify both parties still have at least one copy of the card they
 * offered. Called inside the accept transaction, immediately before the
 * swap — the caller may have sold the card since the offer was made.
 */
async function bothPartiesOwnOfferedCards(conn, trade) {
	const initOwns = await userOwnsCard(
		conn,
		trade.initiator_id,
		trade.initiator_card_id
	)
	if (!initOwns) return 'INITIATOR_NO_LONGER_OWNS_CARD'

	const recvOwns = await userOwnsCard(
		conn,
		trade.receiver_id,
		trade.receiver_card_id
	)
	if (!recvOwns) return 'RECEIVER_NO_LONGER_OWNS_CARD'

	return null
}

// ── POST /api/trades ────────────────────────────────────────
// Create a new trade offer from the caller (initiator) to another
// player (receiver). Anti-abuse rules are checked at create time so
// the receiver never sees an offer that would fail on accept.
router.post('/', requireAuth, async (req, res) => {
	const initiator_id = req.user.user_id
	const { receiver_id, initiator_card_id, receiver_card_id } = req.body

	// ── Basic input validation ──
	if (!receiver_id || !initiator_card_id || !receiver_card_id) {
		return error(
			res,
			400,
			'receiver_id, initiator_card_id and receiver_card_id are required'
		)
	}
	if (Number(receiver_id) === initiator_id) {
		return error(res, 400, 'You cannot trade with yourself')
	}

	const conn = await pool.getConnection()
	try {
		await conn.beginTransaction()

		// ── Ownership ──
		if (
			!(await userOwnsCard(
				conn,
				initiator_id,
				initiator_card_id
			))
		) {
			await conn.rollback()
			return error(
				res,
				400,
				'You do not own the card you are offering'
			)
		}
		if (
			!(await userOwnsCard(
				conn,
				receiver_id,
				receiver_card_id
			))
		) {
			await conn.rollback()
			return error(
				res,
				400,
				'The receiver does not own the card they are offering'
			)
		}

		// ── Anti-abuse rule 1: daily cap ──
		const recent = await tradesCompletedInLast24h(
			conn,
			initiator_id
		)
		if (recent >= DAILY_TRADE_CAP) {
			await conn.rollback()
			return error(
				res,
				429,
				`Daily trade limit reached (${DAILY_TRADE_CAP} per 24h)`
			)
		}

		// ── Anti-abuse rule 2: value symmetry ──
		const [rarityRows] = await conn.query(
			`SELECT card_id, rarity FROM cards
			  WHERE card_id IN (?, ?)`,
			[initiator_card_id, receiver_card_id]
		)
		const rarityMap = new Map(
			rarityRows.map((r) => [r.card_id, r.rarity])
		)
		const initVal = RARITY_POINTS[rarityMap.get(initiator_card_id)]
		const recvVal = RARITY_POINTS[rarityMap.get(receiver_card_id)]
		if (initVal == null || recvVal == null) {
			await conn.rollback()
			return error(
				res,
				400,
				'One or both cards have an unknown rarity'
			)
		}
		if (Math.abs(initVal - recvVal) > MAX_VALUE_ASYMMETRY) {
			await conn.rollback()
			return error(
				res,
				400,
				`Trade values are too asymmetric (max difference: ${MAX_VALUE_ASYMMETRY} points)`
			)
		}

		// ── Anti-abuse rule 3: account age ──
		const [ageRows] = await conn.query(
			`SELECT user_id,
			        TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_s
			   FROM users WHERE user_id IN (?, ?)`,
			[initiator_id, receiver_id]
		)
		const tooNew = ageRows.find((r) => r.age_s < MIN_ACCOUNT_AGE_S)
		if (tooNew) {
			await conn.rollback()
			return error(
				res,
				403,
				'One or both accounts are too new to trade'
			)
		}

		// ── Create the trade ──
		const [result] = await conn.query(
			`INSERT INTO trades
			   (initiator_id, receiver_id, initiator_card_id, receiver_card_id)
			 VALUES (?, ?, ?, ?)`,
			[
				initiator_id,
				receiver_id,
				initiator_card_id,
				receiver_card_id,
			]
		)
		const trade_id = result.insertId

		await conn.commit()

		const [rows] = await pool.query(
			'SELECT * FROM trades WHERE trade_id = ?',
			[trade_id]
		)
		return success(res, await decorateTrade(rows[0]))
	} catch (err) {
		await conn.rollback()
		console.error('[trades] create failed:', err)
		return error(res, 500, err.message)
	} finally {
		conn.release()
	}
})

// ── GET /api/trades/incoming ────────────────────────────────
// Offers where the caller is the receiver and the trade is still PENDING.
router.get('/incoming', requireAuth, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT * FROM trades
			  WHERE receiver_id = ? AND status = 'PENDING'
			  ORDER BY created_at DESC`,
			[req.user.user_id]
		)
		const trades = await Promise.all(
			rows.map((r) => decorateTrade(r))
		)
		return success(res, trades)
	} catch (err) {
		return error(res, 500, err.message)
	}
})

// ── GET /api/trades/outgoing ────────────────────────────────
// Offers the caller has made.
router.get('/outgoing', requireAuth, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT * FROM trades
			  WHERE initiator_id = ?
			  ORDER BY created_at DESC`,
			[req.user.user_id]
		)
		const trades = await Promise.all(
			rows.map((r) => decorateTrade(r))
		)
		return success(res, trades)
	} catch (err) {
		return error(res, 500, err.message)
	}
})

// ── POST /api/trades/:id/accept ─────────────────────────────
// Atomic accept: verifies ownership, swaps both cards, marks trade
// ACCEPTED, all in a single transaction. Concurrent accepts are
// serialized by SELECT … FOR UPDATE on the trade row.
router.post('/:id/accept', requireAuth, async (req, res) => {
	const trade_id = req.params.id
	const user_id = req.user.user_id

	const conn = await pool.getConnection()
	try {
		await conn.beginTransaction()

		// Lock the trade row — a second concurrent accept will block here
		// until the first transaction commits, then see status != PENDING
		// and bail out.
		const [rows] = await conn.query(
			'SELECT * FROM trades WHERE trade_id = ? FOR UPDATE',
			[trade_id]
		)
		if (!rows.length) {
			await conn.rollback()
			return error(res, 404, 'Trade not found')
		}
		const trade = rows[0]

		if (trade.receiver_id !== user_id) {
			await conn.rollback()
			return error(
				res,
				403,
				'Only the receiver can accept this trade'
			)
		}
		if (trade.status !== 'PENDING') {
			await conn.rollback()
			return error(
				res,
				409,
				`Trade is already ${trade.status.toLowerCase()}`
			)
		}

		// Re-check ownership — the initiator may have sold their card
		// since the offer was made.
		const ownershipProblem = await bothPartiesOwnOfferedCards(
			conn,
			trade
		)
		if (ownershipProblem) {
			await conn.rollback()
			return error(
				res,
				409,
				`Cannot accept: ${ownershipProblem}`
			)
		}

		// ── The swap ──
		await transferCard(
			conn,
			trade.initiator_id,
			trade.receiver_id,
			trade.initiator_card_id
		)
		await transferCard(
			conn,
			trade.receiver_id,
			trade.initiator_id,
			trade.receiver_card_id
		)

		await conn.query(
			`UPDATE trades
			    SET status = 'ACCEPTED', resolved_at = NOW()
			  WHERE trade_id = ?`,
			[trade_id]
		)

		await conn.commit()

		const [final] = await pool.query(
			'SELECT * FROM trades WHERE trade_id = ?',
			[trade_id]
		)
		return success(res, await decorateTrade(final[0]))
	} catch (err) {
		await conn.rollback()
		console.error('[trades] accept failed:', err)
		return error(res, 500, err.message)
	} finally {
		conn.release()
	}
})

// ── POST /api/trades/:id/decline ────────────────────────────
// Receiver-only. Marks the trade DECLINED without touching cards.
router.post('/:id/decline', requireAuth, async (req, res) => {
	const trade_id = req.params.id
	const user_id = req.user.user_id

	try {
		const [rows] = await pool.query(
			'SELECT * FROM trades WHERE trade_id = ?',
			[trade_id]
		)
		if (!rows.length) return error(res, 404, 'Trade not found')
		const trade = rows[0]

		if (trade.receiver_id !== user_id) {
			return error(
				res,
				403,
				'Only the receiver can decline this trade'
			)
		}
		if (trade.status !== 'PENDING') {
			return error(
				res,
				409,
				`Trade is already ${trade.status.toLowerCase()}`
			)
		}

		await pool.query(
			`UPDATE trades
			    SET status = 'DECLINED', resolved_at = NOW()
			  WHERE trade_id = ?`,
			[trade_id]
		)

		return success(res, { message: 'Trade declined' })
	} catch (err) {
		return error(res, 500, err.message)
	}
})

// ── POST /api/trades/:id/cancel ─────────────────────────────
// Initiator-only. Marks the trade CANCELLED.
router.post('/:id/cancel', requireAuth, async (req, res) => {
	const trade_id = req.params.id
	const user_id = req.user.user_id

	try {
		const [rows] = await pool.query(
			'SELECT * FROM trades WHERE trade_id = ?',
			[trade_id]
		)
		if (!rows.length) return error(res, 404, 'Trade not found')
		const trade = rows[0]

		if (trade.initiator_id !== user_id) {
			return error(
				res,
				403,
				'Only the initiator can cancel this trade'
			)
		}
		if (trade.status !== 'PENDING') {
			return error(
				res,
				409,
				`Trade is already ${trade.status.toLowerCase()}`
			)
		}

		await pool.query(
			`UPDATE trades
			    SET status = 'CANCELLED', resolved_at = NOW()
			  WHERE trade_id = ?`,
			[trade_id]
		)

		return success(res, { message: 'Trade cancelled' })
	} catch (err) {
		return error(res, 500, err.message)
	}
})

export default router
