import express from 'express'

import pool from '../utils/db.js'
import { DEFAULT_CONFIG } from '../placement/placement.js'
import {
	runRotation,
	createProceduralEvents,
	loadZoneLastUsed,
	campusGraph,
} from '../placement/rotation_job.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Placement Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
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

async function requireEventAuthor(req, res, next) {
	const allowedRoles = ['SUPER_ADMIN', 'EVENT_AUTHOR']
	const placeholders = allowedRoles.map(() => '?').join(', ')

	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[req.user.user_id, ...allowedRoles]
		)
		if (!rows.length) {
			return res.status(403).json({
				error: 'Forbidden — event author role required',
			})
		}
		next()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
}

/**
 * GET /api/placement/status
 * A dashboard snapshot: current config, live pop-ups, the path graph
 * (for rendering), each zone's last-used time, and recent run history.
 */
router.get('/status', requireAuth, requireEventAuthor, async (req, res) => {
	try {
		const [activeEvents] = await pool.query(
			`SELECT event_id, title, latitude, longitude, radius_meters,
			        placement_zone AS zone, starts_at, ends_at
			   FROM events
			  WHERE is_procedural = TRUE AND is_active = TRUE
			  ORDER BY ends_at ASC`
		)

		const zoneLastUsed = await loadZoneLastUsed(pool)
		const zones = campusGraph.zones.map((z) => ({
			id: z.id,
			name: z.name,
			bounds: z.bounds,
			lastUsed: zoneLastUsed[z.id] ?? null,
		}))

		const [recentRuns] = await pool.query(
			`SELECT run_id, started_at, finished_at, retired_count, created_count, status, error
			   FROM placement_runs
			  ORDER BY run_id DESC
			  LIMIT 10`
		)

		res.json({
			config: DEFAULT_CONFIG,
			activeEvents,
			graph: {
				nodes: campusGraph.nodes,
				edges: campusGraph.edges,
			},
			zones,
			recentRuns,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /api/placement/generate
 * Fills up to config.maxLive new pop-up events WITHOUT retiring anything
 * first. Reuses rotation_job.js's createProceduralEvents directly — no
 * placement logic is duplicated here.
 */
router.post('/generate', requireAuth, requireEventAuthor, async (req, res) => {
	try {
		const result = await createProceduralEvents(pool, {})
		res.json(result)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

/**
 * POST /api/placement/rotate
 * Runs a full rotation (retire expired + fill back up) immediately, via
 * the same runRotation the scheduled job calls — bypasses the "is it due
 * yet" check, so a rotation can be demoed on demand.
 */
router.post('/rotate', requireAuth, requireEventAuthor, async (req, res) => {
	try {
		const result = await runRotation(pool, {})
		res.json(result)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
