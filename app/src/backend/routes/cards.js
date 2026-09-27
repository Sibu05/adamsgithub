import express from 'express'
import { RARITY_POINTS } from '../utils/rarity_points.js'

import pool from '../utils/db.js'
import { error, success } from '../utils/response.js'
import { valid_user_cards } from '../utils/battle.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Cards Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	if (!req.user?.user_id) {
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	}
	next()
}

router.post('/valid-cards', requireAuth, async (req, res) => {
	try {
		var deck = req.body
		if (deck.length != 5) success(res, false)
		if (!(await valid_user_cards(req.user, deck)))
			success(res, false)
		success(res, true)
	} catch (err) {
		console.error(err)
		error(res, 500, err.message)
	}
})

router.get('/get-all', requireAuth, async (req, res) => {
	try {
		const [rows, fields] = await pool.query(
			// 'SELECT * FROM cards WHERE EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ?)',
			'SELECT c.*,uc.quantity FROM cards c JOIN user_cards uc ON c.card_id = uc.card_id WHERE uc.user_id = ?',
			[req.user.user_id]
		)
		success(res, rows)
	} catch (err) {
		console.error(err)
		error(res, 500, err.message)
	}
})

/**
 * FIXED: converted callback-style pool.query -> async/await.
 * Previously the callback was silently ignored by mysql2/promise,
 * so next() was never called and every POST/PUT/DELETE hung forever.
 */
async function requireCardAuthor(req, res, next) {
	const allowedRoles = ['SUPER_ADMIN', 'CARD_AUTHOR']
	const placeholders = allowedRoles.map(() => '?').join(', ')

	const sql = `
		SELECT 1 FROM admin_roles
		WHERE user_id = ?
			AND role IN (${placeholders})
		LIMIT 1
	`

	try {
		const [rows] = await pool.query(sql, [
			req.user.user_id,
			...allowedRoles,
		])
		if (!rows.length) {
			return res.status(403).json({
				error: 'Forbidden — card author role required',
			})
		}
		next()
	} catch (err) {
		return res.status(500).json({ error: err.message })
	}
}

// ── PLAYER ROUTES ──

router.get('/', async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT
				card_id, name, flavour_text, image_url,
				category, rarity,
				stat_attack, stat_location, stat_influence, stat_legacy, stat_era,
				ability_name, ability_desc,
				created_at
			FROM cards
			ORDER BY category, rarity, name`
		)
		res.json(rows)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get('/:id', async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT
				card_id, name, flavour_text, image_url,
				category, rarity,
				stat_attack, stat_location, stat_influence, stat_legacy, stat_era,
				ability_name, ability_desc,
				created_at
			FROM cards
			WHERE card_id = ?`,
			[req.params.id]
		)
		if (!rows.length) {
			return res.status(404).json({ error: 'Card not found' })
		}
		res.json(rows[0])
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get('/collection/mine', requireAuth, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT
				uc.user_card_id,
				uc.quantity,
				uc.obtained_at,
				c.card_id, c.name, c.flavour_text, c.image_url,
				c.category, c.rarity,
				c.stat_attack, c.stat_location, c.stat_influence, c.stat_legacy, c.stat_era,
				c.ability_name, c.ability_desc
			FROM user_cards uc
			JOIN cards c ON c.card_id = uc.card_id
			WHERE uc.user_id = ?
			ORDER BY c.category, c.rarity, c.name`,
			[req.user.user_id]
		)
		// sell_value: points for selling ONE duplicate (POST /sell), so
		// the collection page shows the same price the server pays.
		res.json(
			rows.map((row) => ({
				...row,
				sell_value: RARITY_POINTS[row.rarity] || 0,
			}))
		)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// ── AUTHOR ROUTES ──

router.post('/', requireAuth, requireCardAuthor, async (req, res) => {
	const {
		name,
		flavour_text,
		image_url,
		category,
		rarity,
		stat_attack,
		stat_location,
		stat_influence,
		stat_legacy,
		stat_era,
		ability_name,
		ability_desc,
	} = req.body

	if (!name || !category || !rarity) {
		return res.status(400).json({
			error: 'name, category, and rarity are required',
		})
	}

	const valid_categories = [
		'CHARACTER',
		'LOCATION',
		'INFLUENCE',
		'HISTORICAL',
	]
	const valid_rarities = [
		'COMMON',
		'UNCOMMON',
		'RARE',
		'EPIC',
		'LEGENDARY',
	]

	if (!valid_categories.includes(category)) {
		return res.status(400).json({
			error: `category must be one of: ${valid_categories.join(', ')}`,
		})
	}
	if (!valid_rarities.includes(rarity)) {
		return res.status(400).json({
			error: `rarity must be one of: ${valid_rarities.join(', ')}`,
		})
	}

	const sql = `
		INSERT INTO cards (
			name, flavour_text, image_url,
			category, rarity,
			stat_attack, stat_location, stat_influence, stat_legacy, stat_era,
			ability_name, ability_desc
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	const values = [
		name,
		flavour_text ?? null,
		image_url ?? null,
		category,
		rarity,
		stat_attack ?? 0,
		stat_location ?? 0,
		stat_influence ?? 0,
		stat_legacy ?? 100,
		stat_era ?? 0,
		ability_name ?? null,
		ability_desc ?? null,
	]

	try {
		const [result] = await pool.query(sql, values)
		res.status(201).json({
			message: 'Card created',
			card_id: result.insertId,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.put('/:id', requireAuth, requireCardAuthor, async (req, res) => {
	const {
		name,
		flavour_text,
		image_url,
		category,
		rarity,
		stat_attack,
		stat_location,
		stat_influence,
		stat_legacy,
		stat_era,
		ability_name,
		ability_desc,
	} = req.body

	if (!name || !category || !rarity) {
		return res.status(400).json({
			error: 'name, category, and rarity are required',
		})
	}

	const sql = `
		UPDATE cards
		SET
			name           = ?,
			flavour_text   = ?,
			image_url      = ?,
			category       = ?,
			rarity         = ?,
			stat_attack    = ?,
			stat_location  = ?,
			stat_influence = ?,
			stat_legacy    = ?,
			stat_era       = ?,
			ability_name   = ?,
			ability_desc   = ?
		WHERE card_id = ?
	`

	const values = [
		name,
		flavour_text ?? null,
		image_url ?? null,
		category,
		rarity,
		stat_attack ?? 0,
		stat_location ?? 0,
		stat_influence ?? 0,
		stat_legacy ?? 100,
		stat_era ?? 0,
		ability_name ?? null,
		ability_desc ?? null,
		req.params.id,
	]

	try {
		const [result] = await pool.query(sql, values)
		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Card not found' })
		}
		res.json({ message: 'Card updated' })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})
// ── SELL DUPLICATE CARD(S) FOR POINTS ──

/**
 * User story 8: duplicates can be converted into points.
 *
 * A player can never sell their last copy of a card.
 * Only duplicate copies can be sold.
 */
router.post('/sell', requireAuth, async (req, res) => {
	const { card_id, quantity } = req.body
	const user_id = req.user.user_id

	if (!card_id || !Number.isInteger(quantity) || quantity < 1) {
		return res.status(400).json({
			error: 'card_id and a positive integer quantity are required',
		})
	}

	const conn = await pool.getConnection()

	try {
		await conn.beginTransaction()

		const [rows] = await conn.query(
			`SELECT uc.user_card_id, uc.quantity, c.rarity
               FROM user_cards uc
               JOIN cards c ON c.card_id = uc.card_id
              WHERE uc.user_id = ? AND uc.card_id = ?
              FOR UPDATE`,
			[user_id, card_id]
		)

		if (!rows.length) {
			await conn.rollback()

			return res.status(404).json({
				error: "You don't own this card.",
			})
		}

		const owned = rows[0]

		if (quantity >= owned.quantity) {
			await conn.rollback()

			return res.status(400).json({
				error: `You only have ${owned.quantity} of this card — you can sell at most ${owned.quantity - 1} (duplicates only, can't sell your last copy).`,
			})
		}

		const pointsEarned =
			(RARITY_POINTS[owned.rarity] || 0) * quantity

		await conn.query(
			`UPDATE user_cards
                SET quantity = quantity - ?
              WHERE user_card_id = ?`,
			[quantity, owned.user_card_id]
		)

		await conn.query(
			`UPDATE users
                SET points = points + ?
              WHERE user_id = ?`,
			[pointsEarned, user_id]
		)

		await conn.query(
			`INSERT INTO point_transactions
                (user_id, delta, reason, reference_id)
             VALUES (?, ?, 'CARD_SOLD', ?)`,
			[user_id, pointsEarned, card_id]
		)

		const [[balance]] = await conn.query(
			'SELECT points FROM users WHERE user_id = ?',
			[user_id]
		)

		await conn.commit()

		res.json({
			success: true,
			card_id,
			quantity_sold: quantity,
			points_earned: pointsEarned,
			remaining_quantity: owned.quantity - quantity,
			points_total: balance?.points ?? null,
		})
	} catch (err) {
		await conn.rollback()
		res.status(500).json({ error: err.message })
	} finally {
		conn.release()
	}
})
router.delete('/:id', requireAuth, requireCardAuthor, async (req, res) => {
	try {
		const [result] = await pool.query(
			'DELETE FROM cards WHERE card_id = ?',
			[req.params.id]
		)
		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Card not found' })
		}
		res.json({ message: 'Card deleted' })
	} catch (err) {
		if (err.code === 'ER_ROW_IS_REFERENCED_2') {
			return res.status(409).json({
				error: 'Cannot delete — card is still linked to an event pool or player collection. Remove those links first.',
			})
		}
		res.status(500).json({ error: err.message })
	}
})

export default router
