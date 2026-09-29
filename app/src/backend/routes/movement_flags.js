import express from 'express'

import pool from '../utils/db.js'
import { WALKING_SPEED_THRESHOLD_MPS } from '../services/movementTrust.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Movement Flags Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId) {
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	}
	if (!req.user) req.user = req.session.user
	next()
}

async function requireModerator(req, res, next) {
	const allowedRoles = ['SUPER_ADMIN', 'MODERATOR', 'EVENT_AUTHOR']
	const placeholders = allowedRoles.map(() => '?').join(', ')

	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[req.user.user_id, ...allowedRoles]
		)
		if (!rows.length) {
			return res.status(403).json({
				error: 'Forbidden — moderator or event author role required',
			})
		}
		next()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
}

function clampInt(value, { min, max, fallback }) {
	const n = Number.parseInt(value, 10)
	if (Number.isNaN(n)) return fallback
	return Math.min(Math.max(n, min), max)
}

/**
 * GET /api/movement-flags?user_id=&limit=&offset=
 * Location checks flagged by the movement trust check (implied travel
 * speed above walking pace since the player's previous verified check),
 * newest first, with both endpoints of the suspicious journey.
 */
router.get('/', requireAuth, requireModerator, async (req, res) => {
	const limit = clampInt(req.query.limit, {
		min: 1,
		max: 200,
		fallback: 50,
	})
	const offset = clampInt(req.query.offset, {
		min: 0,
		max: 1_000_000,
		fallback: 0,
	})
	const userId = req.query.user_id
		? clampInt(req.query.user_id, {
				min: 1,
				max: Number.MAX_SAFE_INTEGER,
				fallback: null,
			})
		: null

	const where = ['l.movement_flagged = TRUE']
	const params = []
	if (userId) {
		where.push('l.user_id = ?')
		params.push(userId)
	}

	try {
		const [flags] = await pool.query(
			`SELECT l.check_id, l.user_id, u.name AS user_name,
			        l.event_id, e.title AS event_title,
			        l.claimed_lat, l.claimed_lng, l.status,
			        l.travel_speed_ms, l.checked_at,
			        l.prev_check_id,
			        p.event_id AS prev_event_id,
			        p.claimed_lat AS prev_lat, p.claimed_lng AS prev_lng,
			        p.checked_at AS prev_checked_at
			   FROM location_check_log l
			   JOIN users u ON u.user_id = l.user_id
			   LEFT JOIN events e ON e.event_id = l.event_id
			   LEFT JOIN location_check_log p ON p.check_id = l.prev_check_id
			  WHERE ${where.join(' AND ')}
			  ORDER BY l.checked_at DESC, l.check_id DESC
			  LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		)

		res.json({
			threshold_mps: WALKING_SPEED_THRESHOLD_MPS,
			limit,
			offset,
			flags,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
