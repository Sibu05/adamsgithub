import express from 'express'
import pool from '../utils/db.js'
import {
	getFlaggedPlayers,
	recommendTier,
	TIERS,
} from '../services/trust_score.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Moderation Router] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId)
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	if (!req.user) req.user = req.session.user
	next()
}

async function requireModerator(req, res, next) {
	const allowed = ['SUPER_ADMIN', 'MODERATOR']
	const placeholders = allowed.map(() => '?').join(', ')
	const userId = req.session?.user?.user_id || req.user?.user_id
	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[userId, ...allowed]
		)
		if (!rows.length)
			return res.status(403).json({
				error: 'Forbidden — moderator role required',
			})
		next()
	} catch (err) {
		return res.status(500).json({ error: err.message })
	}
}

// Default durations per tier (days)
const DEFAULT_DURATION = {
	WARNING: null,
	RESTRICTION: 3,
	SUSPENSION: 7,
}
const STATUS_MAP = {
	WARNING: 'WARNED',
	RESTRICTION: 'RESTRICTED',
	SUSPENSION: 'SUSPENDED',
}

// GET /api/moderation/flagged — sorted by trust_score ASC, with evidence
router.get('/flagged', requireAuth, requireModerator, async (req, res) => {
	try {
		const threshold =
			req.query.threshold != null
				? parseFloat(req.query.threshold)
				: undefined
		const limit =
			req.query.limit != null
				? parseInt(req.query.limit, 10)
				: undefined
		const players = await getFlaggedPlayers(pool, {
			threshold,
			limit,
		})
		res.json(players)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// GET /api/moderation/actions — recent actions (audit)
router.get('/actions', requireAuth, requireModerator, async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100)
		const [rows] = await pool.query(
			`SELECT ma.action_id, ma.target_user_id, ma.moderator_id, ma.action_type, ma.reason, ma.evidence, ma.duration_days, ma.expires_at, ma.created_at,
			        u.name AS target_name, u.email AS target_email, m.name AS moderator_name
			 FROM moderation_actions ma
			 JOIN users u ON u.user_id = ma.target_user_id
			 JOIN users m ON m.user_id = ma.moderator_id
			 ORDER BY ma.created_at DESC LIMIT ?`,
			[limit]
		)
		// parse evidence JSON if string
		const out = rows.map((r) => {
			let ev = r.evidence
			if (typeof ev === 'string') {
				try {
					ev = JSON.parse(ev)
				} catch {
					/* keep raw */
				}
			}
			return { ...r, evidence: ev }
		})
		res.json(out)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// GET /api/moderation/history/:userId
router.get(
	'/history/:userId',
	requireAuth,
	requireModerator,
	async (req, res) => {
		try {
			const { userId } = req.params
			const [rows] = await pool.query(
				`SELECT action_id, target_user_id, moderator_id, action_type, reason, evidence, duration_days, expires_at, created_at
			 FROM moderation_actions WHERE target_user_id = ? ORDER BY created_at DESC`,
				[userId]
			)
			const out = rows.map((r) => {
				let ev = r.evidence
				if (typeof ev === 'string') {
					try {
						ev = JSON.parse(ev)
					} catch {}
				}
				return { ...r, evidence: ev }
			})
			res.json(out)
		} catch (err) {
			res.status(500).json({ error: err.message })
		}
	}
)

// GET /api/moderation/trust-scores — raw table (for debugging / future swap audit)
router.get('/trust-scores', requireAuth, requireModerator, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT uts.user_id, uts.trust_score, uts.evidence, uts.reason, uts.updated_at,
			        u.name, u.email
			 FROM user_trust_scores uts JOIN users u ON u.user_id = uts.user_id
			 ORDER BY uts.trust_score ASC`
		)
		const out = rows.map((r) => {
			let ev = r.evidence
			if (typeof ev === 'string') {
				try {
					ev = JSON.parse(ev)
				} catch {}
			}
			return {
				...r,
				evidence: ev,
				trust_score: Number(r.trust_score),
			}
		})
		res.json(out)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// POST /api/moderation/action — graduated response (WARNING → RESTRICTION → SUSPENSION)
router.post('/action', requireAuth, requireModerator, async (req, res) => {
	const { target_user_id, action_type, reason, duration_days, evidence } =
		req.body

	if (!target_user_id || !action_type)
		return res.status(400).json({
			error: 'target_user_id and action_type are required',
		})
	if (!TIERS.includes(action_type))
		return res.status(400).json({
			error: `action_type must be one of ${TIERS.join(', ')}`,
		})

	const targetId = parseInt(target_user_id, 10)
	if (!Number.isInteger(targetId))
		return res
			.status(400)
			.json({ error: 'target_user_id must be an integer' })

	// Cannot moderate yourself
	const moderatorId = req.session?.user?.user_id || req.user?.user_id
	if (moderatorId === targetId)
		return res
			.status(400)
			.json({ error: 'You cannot moderate yourself' })

	try {
		const [users] = await pool.query(
			`SELECT user_id FROM users WHERE user_id = ?`,
			[targetId]
		)
		if (!users.length)
			return res
				.status(404)
				.json({ error: 'Target user not found' })

		// Fetch prior actions and trust score for recommendation / graduated check
		let prior = []
		let trustScore = null
		try {
			const [p] = await pool.query(
				`SELECT action_type FROM moderation_actions WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 10`,
				[targetId]
			)
			prior = p
		} catch {}
		try {
			const [ts] = await pool.query(
				`SELECT trust_score FROM user_trust_scores WHERE user_id = ?`,
				[targetId]
			)
			if (ts.length) trustScore = Number(ts[0].trust_score)
		} catch {}

		const recommended = recommendTier(trustScore, prior)
		// Graduated enforcement hint: if target trust is moderate (e.g. 65) and
		// moderator jumps straight to SUSPENSION, we include a warning but still allow.
		// If product wants strict enforcement, uncomment the block below:
		// if (recommended && action_type === 'SUSPENSION' && trustScore != null && trustScore >= 50) {
		//   return res.status(400).json({ error: `Graduated response: trust ${trustScore} suggests ${recommended}, not SUSPENSION`, recommended })
		// }

		// Determine expiry
		let duration =
			duration_days != null
				? parseInt(duration_days, 10)
				: DEFAULT_DURATION[action_type]
		if (action_type === 'WARNING') duration = null
		if (
			duration != null &&
			(!Number.isInteger(duration) ||
				duration < 1 ||
				duration > 90)
		)
			return res
				.status(400)
				.json({ error: 'duration_days must be 1-90' })

		let expiresAt = null
		if (duration != null) {
			const d = new Date()
			d.setDate(d.getDate() + duration)
			// format as UTC YYYY-MM-DD HH:MM:SS for DATETIME
			const p = (n) => String(n).padStart(2, '0')
			expiresAt = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
		}

		const evidenceJson =
			evidence != null ? JSON.stringify(evidence) : null

		const conn = await pool.getConnection()
		try {
			await conn.beginTransaction()

			const [result] = await conn.query(
				`INSERT INTO moderation_actions (target_user_id, moderator_id, action_type, reason, evidence, duration_days, expires_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					targetId,
					moderatorId,
					action_type,
					reason || null,
					evidenceJson,
					duration,
					expiresAt,
				]
			)

			// Update users moderation_status if column exists
			try {
				await conn.query(
					`UPDATE users SET moderation_status = ?, moderation_expires_at = ? WHERE user_id = ?`,
					[
						STATUS_MAP[action_type],
						expiresAt,
						targetId,
					]
				)
			} catch (e) {
				// column may not exist on older DB — ignore, action log is still recorded
				if (
					!String(e.message).includes(
						'Unknown column'
					)
				)
					throw e
			}

			await conn.commit()

			res.status(201).json({
				message: `${action_type} applied`,
				action_id: result.insertId,
				target_user_id: targetId,
				action_type,
				reason: reason || null,
				duration_days: duration,
				expires_at: expiresAt,
				recommended_action: recommended,
				graduated_hint:
					recommended &&
					recommended !== action_type
						? `Trust ${trustScore} + history suggests ${recommended}; you applied ${action_type}.`
						: null,
			})
		} catch (txErr) {
			await conn.rollback()
			throw txErr
		} finally {
			conn.release()
		}
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// POST /api/moderation/trust-score — upsert mocked score (moderator only, for testing)
router.post('/trust-score', requireAuth, requireModerator, async (req, res) => {
	const { user_id, trust_score, evidence, reason } = req.body
	if (user_id == null || trust_score == null)
		return res
			.status(400)
			.json({ error: 'user_id and trust_score are required' })
	const score = Number(trust_score)
	if (!Number.isFinite(score) || score < 0 || score > 100)
		return res
			.status(400)
			.json({ error: 'trust_score must be 0-100' })
	try {
		const [u] = await pool.query(
			`SELECT user_id FROM users WHERE user_id = ?`,
			[user_id]
		)
		if (!u.length)
			return res.status(404).json({ error: 'User not found' })
		const evJson =
			evidence != null ? JSON.stringify(evidence) : null
		await pool.query(
			`INSERT INTO user_trust_scores (user_id, trust_score, evidence, reason)
			 VALUES (?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE trust_score = VALUES(trust_score), evidence = VALUES(evidence), reason = VALUES(reason)`,
			[user_id, score, evJson, reason || null]
		)
		res.json({
			message: 'Trust score set',
			user_id,
			trust_score: score,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
