import fs from 'fs'
import path from 'path'
import url from 'url'

import { generatePlacements, createRng, DEFAULT_CONFIG } from './placement.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

export const campusGraph = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'campus_paths.json'), 'utf-8')
)
const popupQuestionBank = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'popup_questions.json'), 'utf-8')
)

const LOCK_NAME = 'placement_rotation'

function toMysqlDatetime(date) {
	const d = new Date(date)
	const p = (n) => String(n).padStart(2, '0')
	return (
		`${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
		` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
	)
}

function zoneNameFor(graph, zoneId) {
	const zone = graph.zones.find((z) => z.id === zoneId)
	return zone ? zone.name : 'Campus'
}

// Fisher-Yates using the run's rng, so picks stay reproducible with a seed.
function shuffle(arr, rng) {
	const a = arr.slice()
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

function pickRandomDistinct(arr, count, rng) {
	return shuffle(arr, rng).slice(0, Math.min(count, arr.length))
}

// ── Question templates ─────────────────────────────────────
// Normalizes both an existing DB question (trivia_questions + its
// trivia_options) and a fallback JSON entry to the same shape
// questions.js's POST handler consumes: {type, text, correctAnswer, options}.

// The formats insertQuestionOnConn knows how to copy — MULTIPLE_SELECT
// would come across with no options, so it's never picked.
const COPYABLE_FORMATS = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK']

function normalizeDbTemplate(row, options) {
	let correctAnswer = null
	let optionBodies
	if (row.format === 'MULTIPLE_CHOICE') {
		correctAnswer = options.find((o) => o.is_correct)?.body ?? null
		optionBodies = options.map((o) => o.body)
	} else if (row.format === 'TRUE_FALSE') {
		const trueOpt = options.find((o) => o.body === 'True')
		correctAnswer = trueOpt?.is_correct ? 'true' : 'false'
	} else if (row.format === 'FILL_BLANK') {
		correctAnswer = options[0]?.body ?? null
	}
	return {
		id: `db:${row.question_id}`,
		type: row.format,
		text: row.body,
		correctAnswer,
		options: optionBodies,
	}
}

function normalizeJsonTemplate(entry) {
	return {
		id: `json:${entry.id}`,
		type: entry.type,
		text: entry.text,
		correctAnswer: entry.correctAnswer,
		options: entry.options,
	}
}

// A DB question with missing options/answer would copy into an
// unanswerable pop-up question — skip it.
function isCopyable(q) {
	if (q.correctAnswer == null) return false
	if (q.type === 'MULTIPLE_CHOICE') return q.options.length >= 2
	return true
}

const questionKey = (q) => q.text.trim().toLowerCase()

/**
 * Questions from every PUBLISHED, non-procedural event — the curated
 * content pop-ups borrow from. Procedural events are excluded so a
 * pop-up never copies another pop-up's copy; drafts, in-review, retired
 * and archived events are excluded by requiring PUBLISHED.
 */
async function loadEligibleDbQuestions(db) {
	const [rows] = await db.query(
		`SELECT tq.question_id, tq.format, tq.body
		   FROM trivia_questions tq
		   JOIN events e ON e.event_id = tq.event_id
		  WHERE e.curation_status = 'PUBLISHED'
		    AND e.is_procedural = FALSE
		    AND tq.format IN (?)`,
		[COPYABLE_FORMATS]
	)
	if (!rows.length) return []

	const [optionRows] = await db.query(
		`SELECT question_id, body, is_correct
		   FROM trivia_options
		  WHERE question_id IN (?)
		  ORDER BY option_id`,
		[rows.map((r) => r.question_id)]
	)
	const optionsByQuestion = new Map()
	for (const o of optionRows) {
		if (!optionsByQuestion.has(o.question_id))
			optionsByQuestion.set(o.question_id, [])
		optionsByQuestion.get(o.question_id).push(o)
	}

	// The same question can live on several events — keep one copy.
	const byKey = new Map()
	for (const row of rows) {
		const q = normalizeDbTemplate(
			row,
			optionsByQuestion.get(row.question_id) ?? []
		)
		if (isCopyable(q) && !byKey.has(questionKey(q)))
			byKey.set(questionKey(q), q)
	}
	return [...byKey.values()]
}

/**
 * Pick 2 popup questions at random from existing questions on published,
 * non-procedural events, avoiding questions used by the last
 * `cooldownRotations` pop-up events. Order of preference:
 *   1. fresh DB questions
 *   2. fresh popup_questions.json entries — only to top up when fewer
 *      than 2 fresh DB questions exist
 *   3. anything (recently used included) — better than an event with
 *      fewer than 2 questions
 */
export async function pickPopupQuestions(
	db,
	{ rng, cooldownRotations = DEFAULT_CONFIG.cooldownRotations } = {}
) {
	const dbQuestions = await loadEligibleDbQuestions(db)
	const jsonQuestions = popupQuestionBank.map(normalizeJsonTemplate)

	const [recentRows] = await db.query(
		`SELECT tq.body
		   FROM trivia_questions tq
		   JOIN (
		     SELECT event_id FROM events
		      WHERE is_procedural = TRUE
		      ORDER BY created_at DESC
		      LIMIT ?
		   ) recent ON recent.event_id = tq.event_id`,
		[cooldownRotations]
	)
	const recent = new Set(
		recentRows.map((r) => r.body.trim().toLowerCase())
	)
	const isFresh = (q) => !recent.has(questionKey(q))

	const picks = []
	const fill = (candidates) => {
		const chosen = new Set(picks.map(questionKey))
		const available = candidates.filter(
			(q) => !chosen.has(questionKey(q))
		)
		picks.push(
			...pickRandomDistinct(available, 2 - picks.length, rng)
		)
	}

	fill(dbQuestions.filter(isFresh))
	if (picks.length < 2) fill(jsonQuestions.filter(isFresh))
	if (picks.length < 2) fill([...dbQuestions, ...jsonQuestions])

	return picks
}

// cards.rarity is COMMON/UNCOMMON/RARE/EPIC/LEGENDARY (schema.sql) —
// weight so rarer tiers are proportionally less likely to seed a pop-up's
// card pool. Unknown/missing rarity falls back to the rarest weight.
const RARITY_WEIGHTS = {
	COMMON: 50,
	UNCOMMON: 25,
	RARE: 15,
	EPIC: 7,
	LEGENDARY: 3,
}

// Roulette-wheel sampling WITHOUT replacement — each pick removes its
// candidate from the pool so `count` distinct items always come back.
function weightedSampleDistinct(items, weights, count, rng) {
	const remaining = items.map((item, i) => ({ item, weight: weights[i] }))
	const picked = []
	while (picked.length < count && remaining.length > 0) {
		const total = remaining.reduce((sum, c) => sum + c.weight, 0)
		let r = rng() * total
		let idx = remaining.length - 1
		for (let i = 0; i < remaining.length; i++) {
			r -= remaining[i].weight
			if (r <= 0) {
				idx = i
				break
			}
		}
		picked.push(remaining[idx].item)
		remaining.splice(idx, 1)
	}
	return picked
}

/** Pick 1-3 random cards to seed the new event's card pool with, weighted
 * so commons are more likely than rares/epics/legendaries. */
export async function pickPopupCards(db, { rng }) {
	const [rows] = await db.query('SELECT card_id, rarity FROM cards')
	const count = 1 + Math.floor(rng() * 3) // 1..3
	return weightedSampleDistinct(
		rows.map((r) => r.card_id),
		rows.map(
			(r) =>
				RARITY_WEIGHTS[r.rarity] ??
				RARITY_WEIGHTS.LEGENDARY
		),
		count,
		rng
	)
}

/**
 * Retire procedural events whose TTL (baked into ends_at at creation)
 * has passed — same shape as the curation "retire" endpoint in events.js:
 * is_active = FALSE, curation_status = 'RETIRED', retired_at set.
 */
export async function retireExpiredEvents(db, { now }) {
	const nowStr = toMysqlDatetime(now)
	const [result] = await db.query(
		`UPDATE events
		    SET is_active = FALSE, curation_status = 'RETIRED', retired_at = ?
		  WHERE is_procedural = TRUE AND is_active = TRUE AND ends_at <= ?`,
		[nowStr, nowStr]
	)
	return result.affectedRows
}

export async function loadActiveEvents(db) {
	const [rows] = await db.query(
		`SELECT event_id, latitude, longitude FROM events WHERE is_active = TRUE`
	)
	return rows
}

export async function loadRecentProceduralSpots(db, { limit }) {
	const [rows] = await db.query(
		`SELECT latitude, longitude FROM events
		  WHERE is_procedural = TRUE
		  ORDER BY created_at DESC
		  LIMIT ?`,
		[limit]
	)
	return rows
}

export async function loadZoneLastUsed(db) {
	const [rows] = await db.query(
		`SELECT placement_zone, MAX(created_at) AS last_used
		   FROM events
		  WHERE is_procedural = TRUE AND placement_zone IS NOT NULL
		  GROUP BY placement_zone`
	)
	const map = {}
	for (const row of rows) {
		map[row.placement_zone] = new Date(row.last_used).getTime()
	}
	return map
}

/** env PLACEMENT_AUTHOR_ID, else the first SUPER_ADMIN, else null. */
export async function resolveAuthorId(db) {
	if (process.env.PLACEMENT_AUTHOR_ID) {
		const id = Number(process.env.PLACEMENT_AUTHOR_ID)
		if (Number.isInteger(id)) return id
	}
	const [rows] = await db.query(
		`SELECT user_id FROM admin_roles WHERE role = 'SUPER_ADMIN' ORDER BY user_id ASC LIMIT 1`
	)
	return rows.length ? rows[0].user_id : null
}

async function insertPopupEvent(conn, { graph, spot, config, now, authorId }) {
	const startsAt = toMysqlDatetime(now)
	const endsAt = toMysqlDatetime(
		new Date(now.getTime() + config.eventTtlMinutes * 60000)
	)

	const [result] = await conn.query(
		`INSERT INTO events (
		   title, description, latitude, longitude, radius_meters,
		   starts_at, ends_at, is_active, author_id,
		   curation_status, published_at, is_procedural, placement_zone
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, 'PUBLISHED', ?, TRUE, ?)`,
		[
			`Pop-up Quest: ${zoneNameFor(graph, spot.zone)}`,
			'A procedurally placed pop-up event.',
			spot.lat,
			spot.lng,
			config.radiusMeters,
			startsAt,
			endsAt,
			authorId,
			startsAt,
			spot.zone,
		]
	)
	return result.insertId
}

// Same insert shape as questions.js's POST /events/:eventId/questions.
async function insertQuestionOnConn(conn, eventId, q) {
	const [result] = await conn.query(
		`INSERT INTO trivia_questions (event_id, format, body, time_limit_s, difficulty)
		 VALUES (?, ?, ?, 30, 1)`,
		[eventId, q.type, q.text]
	)
	const questionId = result.insertId

	if (q.type === 'MULTIPLE_CHOICE') {
		for (const opt of q.options) {
			await conn.query(
				`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
				[
					questionId,
					opt,
					String(opt) === String(q.correctAnswer),
				]
			)
		}
	} else if (q.type === 'TRUE_FALSE') {
		const ca = String(q.correctAnswer).toLowerCase()
		await conn.query(
			`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
			[questionId, 'True', ca === 'true']
		)
		await conn.query(
			`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, ?)`,
			[questionId, 'False', ca === 'false']
		)
	} else if (q.type === 'FILL_BLANK') {
		await conn.query(
			`INSERT INTO trivia_options (question_id, body, is_correct) VALUES (?, ?, TRUE)`,
			[questionId, q.correctAnswer]
		)
	}
}

// Same insert shape as event_pool.js's POST /:eventId/pool.
async function insertCardPoolOnConn(conn, eventId, cardId) {
	await conn.query(
		`INSERT INTO event_card_pool (event_id, card_id, weight, global_copy_limit)
		 VALUES (?, ?, 1, NULL)`,
		[eventId, cardId]
	)
}

/**
 * Places new procedural events (each with 2 questions + 1-3 cards) up to
 * config.maxLive, WITHOUT retiring anything first. This is the shared
 * core both runRotation and the "generate now" API route call — pulled
 * out so neither has to duplicate it.
 *
 * @param {import('mysql2/promise').Pool} db
 * @param {object} [opts.graph] - path graph to place on; defaults to the
 *   real campusGraph (loaded from campus_paths.json). Tests inject a
 *   small fixture graph here instead of depending on that file's
 *   contents — see placement/test_fixtures.js.
 */
export async function createProceduralEvents(
	db,
	{
		config = {},
		now = new Date(),
		rng = createRng(Date.now()),
		graph = campusGraph,
	} = {}
) {
	const cfg = { ...DEFAULT_CONFIG, ...config }
	const nowDate = now instanceof Date ? now : new Date(now)

	const authorId = await resolveAuthorId(db)
	if (authorId == null) {
		const error =
			'No PLACEMENT_AUTHOR_ID configured and no SUPER_ADMIN found — skipping event creation'
		console.error(`[placement] ${error}`)
		return { createdCount: 0, status: 'SKIPPED', error }
	}

	const [activeEvents, recentSpots, zoneLastUsed] = await Promise.all([
		loadActiveEvents(db),
		loadRecentProceduralSpots(db, {
			limit: cfg.cooldownRotations * cfg.maxLive,
		}),
		loadZoneLastUsed(db),
	])

	const placements = generatePlacements({
		graph,
		activeEvents,
		recentSpots,
		zoneLastUsed,
		config: cfg,
		rng,
		now: nowDate.getTime(),
	})

	let createdCount = 0
	for (const spot of placements) {
		const conn = await db.getConnection()
		try {
			await conn.beginTransaction()

			const eventId = await insertPopupEvent(conn, {
				graph,
				spot,
				config: cfg,
				now: nowDate,
				authorId,
			})

			const questions = await pickPopupQuestions(db, {
				rng,
				cooldownRotations: cfg.cooldownRotations,
			})
			for (const q of questions) {
				await insertQuestionOnConn(conn, eventId, q)
			}

			const cardIds = await pickPopupCards(db, { rng })
			for (const cardId of cardIds) {
				await insertCardPoolOnConn(
					conn,
					eventId,
					cardId
				)
			}

			await conn.commit()
			createdCount++
		} catch (err) {
			await conn.rollback()
			console.error(
				'[placement] failed to create pop-up event, rolled back:',
				err.message
			)
		} finally {
			conn.release()
		}
	}

	return { createdCount, status: 'SUCCESS', error: null }
}

/**
 * Runs one procedural-placement rotation: retires expired pop-ups, then
 * delegates to createProceduralEvents to fill back up to config.maxLive.
 * Takes a MySQL named lock so two rotation ticks (e.g. across restarts
 * or instances) never overlap. Always logs a placement_runs row and
 * always releases the lock, even on error.
 *
 * GET_LOCK/RELEASE_LOCK are session-scoped in MySQL, so both calls MUST
 * run on the same physical connection — a plain pool.query() for each
 * can silently hand them to different pooled connections, in which case
 * RELEASE_LOCK never reaches the session actually holding the lock. We
 * check out one dedicated connection for the lock's whole lifetime and
 * release it back to the pool only after RELEASE_LOCK has run on it.
 *
 * @param {import('mysql2/promise').Pool} db
 * @param {object} [opts.graph] - see createProceduralEvents; defaults to
 *   the real campusGraph.
 */
export async function runRotation(
	db,
	{
		config = {},
		now = new Date(),
		rng = createRng(Date.now()),
		graph = campusGraph,
	} = {}
) {
	const cfg = { ...DEFAULT_CONFIG, ...config }
	const nowDate = now instanceof Date ? now : new Date(now)
	const startedAt = new Date()

	const lockConn = await db.getConnection()
	try {
		const [[lockRow]] = await lockConn.query(
			`SELECT GET_LOCK('${LOCK_NAME}', 0) AS locked`
		)
		if (!lockRow || Number(lockRow.locked) !== 1) {
			console.log(
				'[placement] rotation already running elsewhere — skipping this tick'
			)
			return { skipped: true, reason: 'LOCK_NOT_ACQUIRED' }
		}

		let retiredCount = 0
		let createdCount = 0
		let status = 'SUCCESS'
		let errorMessage = null

		try {
			retiredCount = await retireExpiredEvents(db, {
				now: nowDate,
			})

			const result = await createProceduralEvents(db, {
				config: cfg,
				now: nowDate,
				rng,
				graph,
			})
			createdCount = result.createdCount
			status = result.status
			errorMessage = result.error
		} catch (err) {
			status = 'FAILED'
			errorMessage = err.message
			console.error(
				'[placement] rotation run failed:',
				err.message
			)
		} finally {
			await db.query(
				`INSERT INTO placement_runs
				   (started_at, finished_at, retired_count, created_count, status, error)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[
					toMysqlDatetime(startedAt),
					toMysqlDatetime(new Date()),
					retiredCount,
					createdCount,
					status,
					errorMessage,
				]
			)
			await lockConn.query(
				`SELECT RELEASE_LOCK('${LOCK_NAME}')`
			)
		}

		return {
			retiredCount,
			createdCount,
			status,
			error: errorMessage,
		}
	} finally {
		lockConn.release()
	}
}

// How often the scheduler wakes up to CHECK whether a rotation is due —
// deliberately much shorter than rotationIntervalMinutes. Multiple
// servers may share one DB, so "one rotation per interval" is enforced
// globally via placement_runs (checked here) plus the GET_LOCK inside
// runRotation (belt and suspenders against a race at the exact same
// millisecond), not by each server keeping its own timer count.
const SCHEDULER_TICK_MS = 60 * 1000

/**
 * Is a rotation due? True when the last SUCCESS run started at least
 * `rotationIntervalMinutes` ago, or there has never been one — which
 * also means a fresh server with an empty map fills it on its very
 * first tick.
 */
export async function isRotationDue(
	db,
	{ now = new Date(), rotationIntervalMinutes }
) {
	const [rows] = await db.query(
		`SELECT started_at FROM placement_runs
		  WHERE status = 'SUCCESS'
		  ORDER BY run_id DESC
		  LIMIT 1`
	)
	if (!rows.length) return true

	const elapsedMs = now.getTime() - new Date(rows[0].started_at).getTime()
	return elapsedMs >= rotationIntervalMinutes * 60000
}

export async function maybeRunRotation(db, config) {
	try {
		const due = await isRotationDue(db, {
			rotationIntervalMinutes: config.rotationIntervalMinutes,
		})
		if (!due) return
		await runRotation(db, { config })
	} catch (err) {
		console.error('[placement] scheduler tick failed:', err.message)
	}
}

/**
 * Starts the rotation scheduler — always on, since multiple servers can
 * share one DB and each one just independently checks in. Ticks every
 * SCHEDULER_TICK_MS (60s) and only actually runs a rotation when
 * isRotationDue() says so; the GET_LOCK inside runRotation is what stops
 * two servers from both running when they happen to check at once. Ticks
 * once immediately on startup too, so a fresh server fills the map
 * straight away instead of waiting for the first interval.
 *
 * Every tick is wrapped in try/catch (in maybeRunRotation) so a bad tick
 * — a dropped DB connection, a query error — is logged and skipped
 * rather than crashing the process.
 */
export function startRotationScheduler(db, config = DEFAULT_CONFIG) {
	const tick = () => {
		maybeRunRotation(db, config).catch((err) =>
			console.error(
				'[placement] scheduler tick failed:',
				err.message
			)
		)
	}

	tick()
	const timer = setInterval(tick, SCHEDULER_TICK_MS)

	console.log(
		`[placement] rotation scheduler started — checking every ${SCHEDULER_TICK_MS / 1000}s, runs when ${config.rotationIntervalMinutes}m+ have passed since the last successful run`
	)
	return timer
}
