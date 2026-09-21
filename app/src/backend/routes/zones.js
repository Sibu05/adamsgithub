import express from 'express'

import pool from '../utils/db.js'
import { error, success } from '../utils/response.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Zones Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

// ── Configuration (Story 8) ─────────────────────────────────
//
// The brief lets us choose the fair rule. Ours: ownership is
// whoever has accumulated the most points from an event's trivia
// challenges in the last OWNERSHIP_WINDOW_HOURS. The incumbent
// gets a 20% defence bonus — challengers must beat their stored
// score × 1.2 to take the zone.

const OWNERSHIP_WINDOW_HOURS = 24
const DEFENCE_BONUS = 1.2

// Points-per-day stipend thresholds. Awarded at most once per
// calendar day per user, lazily when they read their profile.
const ZONE_BONUS_TIERS = [
	{ min_zones: 5, bonus: 150 },
	{ min_zones: 3, bonus: 50 },
]

// ── Auth ────────────────────────────────────────────────────
function requireAuth(req, res, next) {
	if (!req.user?.user_id) {
		return error(res, 401, 'Unauthorised — please log in')
	}
	next()
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Compute the current scoreboard for an event over the ownership
 * window. Returns rows sorted by score DESC: { user_id, name,
 * points } — includes both the current owner and every challenger.
 */
async function computeScoreboard(event_id) {
	const [rows] = await pool.query(
		`SELECT ta.user_id,
		        u.name,
		        SUM(ta.points_awarded) AS points
		   FROM trivia_attempts ta
		   JOIN users u ON u.user_id = ta.user_id
		  WHERE ta.event_id = ?
		    AND ta.is_correct = TRUE
		    AND ta.attempted_at >= (NOW() - INTERVAL ? HOUR)
		  GROUP BY ta.user_id, u.name
		  ORDER BY points DESC, ta.user_id ASC`,
		[event_id, OWNERSHIP_WINDOW_HOURS]
	)
	return rows
}

/**
 * Determine who should currently own a zone, applying the
 * incumbent defence bonus if there is a stored owner.
 *
 * Returns: { owner_id, score, previous_owner_id, changed }
 */
async function resolveOwner(event_id) {
	// Current stored owner (if any)
	const [[current]] = await pool.query(
		'SELECT owner_id, score FROM zone_owners WHERE event_id = ?',
		[event_id]
	)

	const board = await computeScoreboard(event_id)
	if (!board.length) {
		// No activity in the window — zone goes unclaimed
		return {
			owner_id: null,
			score: 0,
			previous_owner_id: current?.owner_id ?? null,
			changed: current?.owner_id != null,
		}
	}

	// Defence bonus: incumbent's effective score is stored × DEFENCE_BONUS
	const incumbent_id = current?.owner_id ?? null
	const incumbent_effective = current
		? Math.floor(current.score * DEFENCE_BONUS)
		: 0

	// Find the top challenger
	const top = board[0]

	// If the incumbent is still on the board, their true score comes
	// from the scoreboard, not the stored cache.
	const incumbent_board_score =
		incumbent_id != null
			? (board.find((r) => r.user_id === incumbent_id)
					?.points ?? 0)
			: 0

	// Who wins? If the top challenger is the incumbent, they keep it.
	if (top.user_id === incumbent_id) {
		return {
			owner_id: incumbent_id,
			score: top.points,
			previous_owner_id: incumbent_id,
			changed: false,
		}
	}

	// Otherwise compare: does the challenger beat the incumbent's
	// defence-boosted score?
	const challenger_score = top.points
	if (challenger_score > incumbent_effective) {
		return {
			owner_id: top.user_id,
			score: challenger_score,
			previous_owner_id: incumbent_id,
			changed: true,
		}
	}

	// Incumbent defends successfully
	return {
		owner_id: incumbent_id,
		score: incumbent_board_score,
		previous_owner_id: incumbent_id,
		changed: false,
	}
}

/**
 * Persist the resolved owner for an event. Called lazily on read.
 * Uses an upsert so the first claim creates a row, and a change
 * overwrites it.
 */
async function persistOwner(event_id, resolution) {
	if (!resolution.owner_id) {
		// No owner this cycle — clear any stale row
		if (resolution.previous_owner_id) {
			await pool.query(
				'DELETE FROM zone_owners WHERE event_id = ?',
				[event_id]
			)
		}
		return
	}
	await pool.query(
		`INSERT INTO zone_owners (event_id, owner_id, score)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   owner_id = VALUES(owner_id),
		   score = VALUES(score)`,
		[event_id, resolution.owner_id, resolution.score]
	)
}

/**
 * Award the daily zone-ownership stipend if the user hasn't
 * received it yet today and they currently own enough zones.
 * Lazy — runs when the user reads their stats.
 *
 * Returns the bonus awarded (0 if none).
 */
async function awardZoneStipendIfDue(user_id) {
	// How many zones does this user currently own?
	const [[{ n }]] = await pool.query(
		'SELECT COUNT(*) AS n FROM zone_owners WHERE owner_id = ?',
		[user_id]
	)

	// Which tier qualifies (if any)?
	const tier = ZONE_BONUS_TIERS.find((t) => n >= t.min_zones)
	if (!tier) return 0

	// Has the user already received a ZONE_BONUS today?
	const [[{ paid }]] = await pool.query(
		`SELECT COUNT(*) AS paid FROM point_transactions
		  WHERE user_id = ?
		    AND reason = 'ZONE_BONUS'
		    AND DATE(created_at) = CURDATE()`,
		[user_id]
	)
	if (paid > 0) return 0

	// Award it
	await pool.query(
		`INSERT INTO point_transactions (user_id, delta, reason, reference_id)
		 VALUES (?, ?, 'ZONE_BONUS', NULL)`,
		[user_id, tier.bonus]
	)
	await pool.query(
		'UPDATE users SET points = points + ? WHERE user_id = ?',
		[user_id, tier.bonus]
	)

	return tier.bonus
}

// ── GET /api/zones ──────────────────────────────────────────
// List every event that has a zone owner (or has been contested
// recently), with the current owner's name and score.
//
// Public read — no session required (matches the leaderboard).
router.get('/', async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT zo.event_id,
			        e.title AS event_title,
			        zo.owner_id,
			        u.name AS owner_name,
			        zo.score,
			        zo.updated_at
			   FROM zone_owners zo
			   JOIN events e ON e.event_id = zo.event_id
			   JOIN users  u ON u.user_id  = zo.owner_id
			  ORDER BY zo.updated_at DESC`
		)
		return success(res, rows)
	} catch (err) {
		return error(res, 500, err.message)
	}
})

// ── GET /api/zones/mine ─────────────────────────────────────
// Which zones the caller currently owns, plus their daily
// stipend status. Lazily awards the stipend if it's due.
//
// NOTE: this route MUST be declared before `/:eventId` for the
// router to match it — Express evaluates routes in order.
router.get('/mine', requireAuth, async (req, res) => {
	try {
		const user_id = req.user.user_id

		const [zones] = await pool.query(
			`SELECT zo.event_id, e.title AS event_title, zo.score, zo.updated_at
			   FROM zone_owners zo
			   JOIN events e ON e.event_id = zo.event_id
			  WHERE zo.owner_id = ?
			  ORDER BY zo.updated_at DESC`,
			[user_id]
		)

		const bonus_awarded = await awardZoneStipendIfDue(user_id)

		return success(res, {
			zones,
			zone_count: zones.length,
			bonus_awarded_today: bonus_awarded,
		})
	} catch (err) {
		return error(res, 500, err.message)
	}
})

// ── GET /api/zones/:eventId ─────────────────────────────────
// Zone detail for a specific event. Resolves the owner fresh
// (so the current requester sees up-to-date status), persists
// it, and returns the scoreboard.
router.get('/:eventId', requireAuth, async (req, res) => {
	const eventId = Number(req.params.eventId)
	try {
		// Confirm the event exists
		const [events] = await pool.query(
			'SELECT event_id, title, radius_meters FROM events WHERE event_id = ?',
			[eventId]
		)
		if (!events.length) {
			return error(res, 404, 'Event not found')
		}

		// Resolve and persist — this is the "concurrent claim
		// resolution" — the deterministic function above decides
		// the owner regardless of how many players have been
		// active. Two simultaneous reads see the same result.
		const resolution = await resolveOwner(eventId)
		await persistOwner(eventId, resolution)

		// Fetch the scoreboard so the client can see challengers
		const scoreboard = await computeScoreboard(eventId)

		// Attach display names
		const ownerRow = scoreboard.find(
			(r) => r.user_id === resolution.owner_id
		)
		const owner = resolution.owner_id
			? {
					user_id: resolution.owner_id,
					name: ownerRow?.name ?? null,
					score: resolution.score,
				}
			: null

		return success(res, {
			event: events[0],
			owner,
			previous_owner_id: resolution.previous_owner_id,
			owner_changed: resolution.changed,
			window_hours: OWNERSHIP_WINDOW_HOURS,
			defence_bonus: DEFENCE_BONUS,
			scoreboard: scoreboard.slice(0, 10),
		})
	} catch (err) {
		return res.status(500).json({ error: err.message })
	}
})

export default router
