import express from 'express'
import pool from '../utils/db.js'
import { distance_meters } from '../utils/geo.js'
import { awardCardIfEligible } from '../services/card_award.js'

const router = express.Router()

// Blocks access to a route unless the player has an active login session.
// Reuses the identical session extraction pattern as routes/trivia.js.
function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId) {
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	}
	if (!req.user) {
		req.user = req.session.user
	}
	next()
}

// Controls whether location geofencing is enforced during sync.
// Matches LOCATION_VERIFICATION_ENABLED behavior in routes/trivia.js.
const LOCATION_VERIFICATION_ENABLED =
	process.env.REQUIRE_LOCATION_VERIFICATION !== 'false'

/**
 * OFFLINE SYNC & DEFERRED VERIFICATION
 *
 * Receives an array of queued trivia attempts captured while the device was offline.
 * Each attempt is evaluated against historical criteria tied to client_timestamp:
 *  1. Time Window Check: Ensures client_timestamp falls between starts_at and ends_at.
 *     - If the event has expired *since* capture, it still passes if valid *at capture*.
 *  2. Geofence Check: Ensures claimed coordinates at capture were within radius_meters.
 *  3. Trivia Correctness Check: Ensures option_id is correct for question_id.
 *  4. Atomic Reward Processing: Awards points and single-issuance cards using transactions.
 */
router.post('/offline-attempts', requireAuth, async (req, res) => {
	const user_id = req.user.user_id
	const { queued_attempts } = req.body

	if (!Array.isArray(queued_attempts) || queued_attempts.length === 0) {
		return res.status(400).json({
			error: 'Array of queued_attempts is required.',
		})
	}

	const results = []

	for (const attempt of queued_attempts) {
		const {
			event_id,
			question_id,
			selected_option_id,
			answer_time_ms,
			claimed_lat,
			claimed_lng,
			client_timestamp,
		} = attempt

		// Validate presence of core parameters for each payload item
		if (
			!event_id ||
			!question_id ||
			!selected_option_id ||
			claimed_lat === undefined ||
			claimed_lng === undefined ||
			!client_timestamp
		) {
			results.push({
				event_id,
				question_id,
				status: 'REJECTED_MALFORMED_PAYLOAD',
				message: 'Missing required offline attempt fields.',
			})
			continue
		}

		const parsedLat = parseFloat(claimed_lat)
		const parsedLng = parseFloat(claimed_lng)
		const attemptTime = new Date(client_timestamp)

		if (
			isNaN(parsedLat) ||
			isNaN(parsedLng) ||
			isNaN(attemptTime.getTime())
		) {
			results.push({
				event_id,
				question_id,
				status: 'REJECTED_INVALID_DATA',
				message: 'Invalid coordinate or timestamp values.',
			})
			continue
		}

		const conn = await pool.getConnection()

		try {
			await conn.beginTransaction()

			// STEP 1: Fetch event definition for active time window & geofence rules
			const [eventRows] = await conn.query(
				`SELECT event_id, latitude, longitude, radius_meters, point_reward, starts_at, ends_at, is_active
         FROM events WHERE event_id = ?`,
				[event_id]
			)

			if (!eventRows.length) {
				results.push({
					event_id,
					question_id,
					status: 'REJECTED_EVENT_NOT_FOUND',
					message: 'Target event does not exist.',
				})
				await conn.rollback()
				conn.release()
				continue
			}

			const event = eventRows[0]

			// STEP 2: TIME WINDOW CHECK (DEFERRED VERIFICATION)
			// Evaluated strictly against the stored client_timestamp, NOT current system time (NOW()).
			const startsAt = event.starts_at
				? new Date(event.starts_at)
				: null
			const endsAt = event.ends_at
				? new Date(event.ends_at)
				: null

			const isBeforeStart = startsAt && attemptTime < startsAt
			const isAfterEnd = endsAt && attemptTime > endsAt

			if (isBeforeStart || isAfterEnd) {
				// Log attempt to database for audit trail
				await conn.query(
					`INSERT INTO offline_trivia_queue (user_id, event_id, question_id, selected_option_id, claimed_lat, claimed_lng, client_timestamp, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'REJECTED_WINDOW_EXPIRED')`,
					[
						user_id,
						event_id,
						question_id,
						selected_option_id,
						parsedLat,
						parsedLng,
						attemptTime,
					]
				)

				await conn.commit()
				conn.release()

				results.push({
					event_id,
					question_id,
					status: 'REJECTED_WINDOW_EXPIRED',
					message: `Attempt timestamp (${attemptTime.toISOString()}) falls outside event window.`,
				})
				continue
			}

			// STEP 3: LOCATION / GEOFENCE CHECK
			let distance = null
			let locationVerified = true

			if (LOCATION_VERIFICATION_ENABLED) {
				distance = distance_meters(
					parsedLat,
					parsedLng,
					parseFloat(event.latitude),
					parseFloat(event.longitude)
				)
				if (distance > event.radius_meters) {
					locationVerified = false
				}
			}

			if (!locationVerified) {
				await conn.query(
					`INSERT INTO offline_trivia_queue (user_id, event_id, question_id, selected_option_id, claimed_lat, claimed_lng, client_timestamp, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'REJECTED_GEOFENCE')`,
					[
						user_id,
						event_id,
						question_id,
						selected_option_id,
						parsedLat,
						parsedLng,
						attemptTime,
					]
				)

				await conn.commit()
				conn.release()

				results.push({
					event_id,
					question_id,
					status: 'REJECTED_GEOFENCE',
					message: `Distance (${Math.round(distance)}m) exceeded allowed radius (${event.radius_meters}m).`,
				})
				continue
			}

			// STEP 4: TRIVIA ANSWER CHECK
			const [optionRows] = await conn.query(
				`SELECT is_correct FROM trivia_options WHERE option_id = ? AND question_id = ?`,
				[selected_option_id, question_id]
			)

			if (!optionRows.length) {
				await conn.rollback()
				conn.release()
				results.push({
					event_id,
					question_id,
					status: 'REJECTED_INVALID_OPTION',
					message: 'Selected option does not match question.',
				})
				continue
			}

			const isCorrect = Boolean(optionRows[0].is_correct)

			if (!isCorrect) {
				await conn.query(
					`INSERT INTO offline_trivia_queue (user_id, event_id, question_id, selected_option_id, claimed_lat, claimed_lng, client_timestamp, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'REJECTED_WRONG_ANSWER')`,
					[
						user_id,
						event_id,
						question_id,
						selected_option_id,
						parsedLat,
						parsedLng,
						attemptTime,
					]
				)

				await conn.commit()
				conn.release()

				results.push({
					event_id,
					question_id,
					status: 'REJECTED_WRONG_ANSWER',
					message: 'Incorrect option submitted.',
				})
				continue
			}

			// STEP 5: ATOMIC AWARD + ATTEMPT LOGGING + POINTS (Matching routes/trivia.js)
			// Points are once-only per event: a synced replay of an
			// already-completed event still logs the attempt but earns 0.
			const [priorWinRows] = await conn.query(
				`SELECT (EXISTS(
					SELECT 1 FROM trivia_attempts ta
					JOIN location_check_log l ON l.check_id = ta.location_check_id
					WHERE ta.user_id = ? AND ta.event_id = ? AND ta.is_correct = 1
					  AND l.status IN ('VERIFIED', 'FALLBACK_QR')
				) OR EXISTS(
					SELECT 1 FROM event_card_awards eca
					WHERE eca.user_id = ? AND eca.event_id = ?
				)) AS had_prior_win`,
				[user_id, event_id, user_id, event_id]
			)
			const hadPriorWin = Boolean(
				priorWinRows[0]?.had_prior_win
			)
			const pointsAwarded = hadPriorWin
				? 0
				: event.point_reward || 10

			// 5a. Insert location log entry with verified status
			const [locCheck] = await conn.query(
				`INSERT INTO location_check_log (user_id, event_id, claimed_lat, claimed_lng, distance_meters, status)
         VALUES (?, ?, ?, ?, ?, 'VERIFIED')`,
				[
					user_id,
					event_id,
					parsedLat,
					parsedLng,
					distance !== null
						? Math.round(distance)
						: 0,
				]
			)

			// 5b. Single-issuance card evaluation
			const award = await awardCardIfEligible(conn, {
				user_id,
				event_id,
			})

			// 5c. Log trivia attempt stamped with captured client timestamp
			await conn.query(
				`INSERT INTO trivia_attempts
           (user_id, event_id, question_id, location_check_id, is_correct, answer_time_ms, card_awarded_id, points_awarded, attempted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					user_id,
					event_id,
					question_id,
					locCheck.insertId,
					true,
					answer_time_ms || 0,
					award.card_id,
					pointsAwarded,
					attemptTime,
				]
			)

			// 5d. Credit user points and record points transaction —
			// skipped on replays (0 points, practice only).
			if (pointsAwarded > 0) {
				await conn.query(
					`UPDATE users SET points = points + ? WHERE user_id = ?`,
					[pointsAwarded, user_id]
				)
				await conn.query(
					`INSERT INTO point_transactions (user_id, delta, reason, reference_id) VALUES (?, ?, 'TRIVIA_WIN', ?)`,
					[user_id, pointsAwarded, event_id]
				)
			}

			// 5e. Log accepted sync request to offline queue table
			await conn.query(
				`INSERT INTO offline_trivia_queue (user_id, event_id, question_id, selected_option_id, claimed_lat, claimed_lng, client_timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`,
				[
					user_id,
					event_id,
					question_id,
					selected_option_id,
					parsedLat,
					parsedLng,
					attemptTime,
				]
			)

			await conn.commit()
			conn.release()

			results.push({
				event_id,
				question_id,
				status: 'ACCEPTED',
				points_awarded: pointsAwarded,
				card_awarded: award.awarded,
				awarded_card: award.card,
				already_completed: hadPriorWin,
				message: hadPriorWin
					? 'Event already completed — practice only, no new points.'
					: 'Offline attempt successfully verified and credited.',
			})
		} catch (err) {
			await conn.rollback()
			conn.release()
			console.error(
				`Error processing offline attempt for event ${event_id}:`,
				err
			)
			results.push({
				event_id,
				question_id,
				status: 'ERROR',
				message: err.message,
			})
		}
	}

	return res.json({ synced: true, results })
})

export default router
