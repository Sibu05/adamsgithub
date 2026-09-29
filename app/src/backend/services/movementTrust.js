import { distance_meters } from '../utils/geo.js'

// Brisk walking is ~1.5–2 m/s; anything sustained above this between two
// verified checks is flagged for review (never auto-punished).
export const WALKING_SPEED_THRESHOLD_MPS = 2.5

// Phone GPS routinely wanders 10–20 m while standing still, and a
// double-submit re-sends the same spot. Moves shorter than this are
// treated as "didn't move" and never flagged.
export const JITTER_TOLERANCE_M = 25

// Floor for the time gap so a 0-second gap (two checks in the same second)
// never divides by zero. A genuine jump of more than JITTER_TOLERANCE_M in
// under a second is still flagged — it's exactly the teleport we want.
export const MIN_ELAPSED_S = 1

function hasCoords(lat, lng) {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lng) &&
		!(lat === 0 && lng === 0)
	)
}

/**
 * Pure speed/flag decision, separated from the DB lookup so it can be
 * unit-tested with plain numbers.
 */
export function assessMovement(distanceM, elapsedS) {
	const elapsed = Math.max(MIN_ELAPSED_S, Number(elapsedS) || 0)
	const speed = distanceM / elapsed
	return {
		travelSpeedMps: Math.round(speed * 100) / 100,
		isSuspicious:
			distanceM >= JITTER_TOLERANCE_M &&
			speed > WALKING_SPEED_THRESHOLD_MPS,
	}
}

/**
 * Compares the player's claimed position against their most recent
 * VERIFIED location check with real coordinates (QR-fallback rows are
 * logged at 0,0 and carry no position).
 *
 * Takes the db handle as a parameter so the trivia submit route can run
 * it on its transaction connection, alongside the log insert it feeds.
 */
export async function analyzeMovement(db, user_id, currentLat, currentLng) {
	const none = {
		prevCheckId: null,
		travelSpeedMps: null,
		isSuspicious: false,
	}
	if (!hasCoords(currentLat, currentLng)) return none

	const [prevRows] = await db.query(
		`SELECT check_id, claimed_lat, claimed_lng,
            TIMESTAMPDIFF(SECOND, checked_at, NOW()) AS elapsed_seconds
     FROM location_check_log
     WHERE user_id = ? AND status = 'VERIFIED'
       AND NOT (claimed_lat = 0 AND claimed_lng = 0)
     ORDER BY checked_at DESC, check_id DESC
     LIMIT 1`,
		[user_id]
	)
	if (!prevRows?.length) return none

	const prev = prevRows[0]
	const distance = distance_meters(
		parseFloat(prev.claimed_lat),
		parseFloat(prev.claimed_lng),
		currentLat,
		currentLng
	)

	// elapsed_seconds computed by MySQL itself (TIMESTAMPDIFF), avoiding any
	// JS Date/timezone parsing ambiguity between the app server and DB.
	return {
		prevCheckId: prev.check_id,
		...assessMovement(distance, prev.elapsed_seconds),
	}
}
