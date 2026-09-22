/**
 * Mocked trust-score service for User Story 5.
 *
 * The moderation queue reads from user_trust_scores (a stub table)
 * sorted by trust_score. Once the real detection pipeline (User Story 4)
 * is ready, swap the internals of getFlaggedPlayers() to call the real
 * scorer — no schema or route change needed.
 */

export const FLAGGED_THRESHOLD = 70
export const TIERS = ['WARNING', 'RESTRICTION', 'SUSPENSION']
// trust breakpoints for recommended tier (lower = more severe)
export const TIER_THRESHOLDS = {
	WARNING: 70,
	RESTRICTION: 50,
	SUSPENSION: 30,
}

/**
 * Recommend a graduated tier based on trust_score and prior actions.
 * Returns one of TIERS or null if not flagged.
 * Pure function — easy to test and to swap with real model later.
 */
export function recommendTier(trustScore, priorActions = []) {
	const score = Number(trustScore)
	if (Number.isNaN(score) || score >= FLAGGED_THRESHOLD) return null
	// Count prior by type
	const hasWarning = priorActions.some((a) => a.action_type === 'WARNING')
	const hasRestriction = priorActions.some(
		(a) => a.action_type === 'RESTRICTION'
	)
	// Escalate: repeat offenders move up one tier
	if (score < 25) return 'SUSPENSION'
	if (score < TIER_THRESHOLDS.RESTRICTION) {
		// very low → suspension if already restricted, else restriction
		return hasRestriction ? 'SUSPENSION' : 'RESTRICTION'
	}
	if (score < TIER_THRESHOLDS.WARNING) {
		if (hasRestriction) return 'SUSPENSION'
		if (hasWarning) return 'RESTRICTION'
		return 'WARNING'
	}
	return null
}

/**
 * Fetch flagged players sorted by trust_score ASC (most suspicious first).
 * Merges stored evidence JSON with recent location_check_log entries.
 */
export async function getFlaggedPlayers(pool, options = {}) {
	const threshold =
		options.threshold != null
			? options.threshold
			: FLAGGED_THRESHOLD
	const limit = Math.min(options.limit || 50, 100)

	// Does the moderation_status column exist? (pre-migration DB)
	let hasModerationCols = true
	try {
		const [cols] = await pool.query(
			`SHOW COLUMNS FROM users LIKE 'moderation_status'`
		)
		hasModerationCols = cols.length > 0
	} catch {
		hasModerationCols = false
	}

	// Pull from mocked trust table
	const userSelect = hasModerationCols
		? `u.user_id, u.name, u.email, u.avatar_url, u.points, u.moderation_status, u.moderation_expires_at`
		: `u.user_id, u.name, u.email, u.avatar_url, u.points`

	const [rows] = await pool.query(
		`SELECT ${userSelect}, uts.trust_score, uts.evidence, uts.reason, uts.updated_at
		 FROM user_trust_scores uts
		 JOIN users u ON u.user_id = uts.user_id
		 WHERE uts.trust_score < ?
		 ORDER BY uts.trust_score ASC
		 LIMIT ?`,
		[threshold, limit]
	)

	// Enrich each row with prior actions and evidence
	const enriched = []
	for (const row of rows) {
		// prior actions
		let prior = []
		try {
			const [actions] = await pool.query(
				`SELECT action_id, action_type, reason, created_at, expires_at, moderator_id
				 FROM moderation_actions WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 10`,
				[row.user_id]
			)
			prior = actions
		} catch {
			prior = []
		}

		// parse evidence JSON (may be string or object)
		let storedEvidence = []
		if (row.evidence != null) {
			try {
				const ev =
					typeof row.evidence === 'string'
						? JSON.parse(row.evidence)
						: row.evidence
				storedEvidence = Array.isArray(ev) ? ev : [ev]
			} catch {
				storedEvidence = []
			}
		}

		// Pull recent location evidence (SPOOFED/FAILED) as live signal
		let liveEvidence = []
		try {
			const [logs] = await pool.query(
				`SELECT check_id, event_id, distance_meters, status, travel_speed_ms, checked_at
				 FROM location_check_log WHERE user_id = ? AND status IN ('SPOOFED','FAILED')
				 ORDER BY checked_at DESC LIMIT 5`,
				[row.user_id]
			)
			liveEvidence = logs.map((l) => ({
				type:
					l.status === 'SPOOFED'
						? 'SPOOFED_LOCATION'
						: 'FAILED_LOCATION',
				check_id: l.check_id,
				event_id: l.event_id,
				distance_meters:
					l.distance_meters != null
						? Number(l.distance_meters)
						: null,
				travel_speed_ms:
					l.travel_speed_ms != null
						? Number(l.travel_speed_ms)
						: null,
				status: l.status,
				checked_at: l.checked_at,
			}))
		} catch {
			liveEvidence = []
		}

		const evidence = [...storedEvidence, ...liveEvidence].slice(
			0,
			8
		)

		const recommended = recommendTier(row.trust_score, prior)

		enriched.push({
			user_id: row.user_id,
			name: row.name,
			email: row.email,
			avatar_url: row.avatar_url,
			points: row.points,
			moderation_status: row.moderation_status || 'NONE',
			moderation_expires_at:
				row.moderation_expires_at || null,
			trust_score: Number(row.trust_score),
			reason: row.reason || null,
			evidence,
			updated_at: row.updated_at,
			prior_actions: prior,
			prior_count: prior.length,
			recommended_action: recommended,
		})
	}

	return enriched
}

export async function getTrustScoreForUser(pool, userId) {
	const [rows] = await pool.query(
		`SELECT trust_score, evidence, reason, updated_at FROM user_trust_scores WHERE user_id = ?`,
		[userId]
	)
	return rows[0] || null
}

export async function setTrustScore(
	pool,
	userId,
	trustScore,
	evidence = null,
	reason = null
) {
	// upsert
	const evJson = evidence != null ? JSON.stringify(evidence) : null
	await pool.query(
		`INSERT INTO user_trust_scores (user_id, trust_score, evidence, reason)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE trust_score = VALUES(trust_score), evidence = VALUES(evidence), reason = VALUES(reason)`,
		[userId, trustScore, evJson, reason]
	)
}

// Adapter: real scorer will replace this function. Keeping the same signature
// means moderation routes don't change when we swap the mock for the ML model.
export async function computeTrustScore(_pool, _userId) {
	// stub — real implementation in User Story 4 will compute from telemetry
	return null
}
