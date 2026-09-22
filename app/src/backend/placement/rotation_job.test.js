import { jest } from '@jest/globals'
import {
	runRotation,
	retireExpiredEvents,
	resolveAuthorId,
	pickPopupQuestions,
	pickPopupCards,
	isRotationDue,
	maybeRunRotation,
	startRotationScheduler,
} from './rotation_job.js'
import { createRng, DEFAULT_CONFIG } from './placement.js'
import { FIXTURE_GRAPH } from './test_fixtures.js'

// A "smart" pooled connection that understands BOTH the GET_LOCK/
// RELEASE_LOCK protocol (routed through a shared `lockState` so the lock
// behaves like a real MySQL named lock — held per-connection, released
// only by whichever connection holds it) AND the ordinary insert queries
// used while creating a pop-up event. In practice a given connection
// instance only ever gets one kind of traffic (the dedicated lock
// connection never sees an INSERT, and vice versa), but making every
// connection "smart" lets makeDb() hand out fresh connection objects on
// every getConnection() call — closer to how a real pool behaves, and
// what's needed to prove GET_LOCK/RELEASE_LOCK share one connection.
function makeSmartConn({ id, lockState, failOn, nextQuestionIdRef }) {
	return {
		beginTransaction: jest.fn(async () => {}),
		commit: jest.fn(async () => {}),
		rollback: jest.fn(async () => {}),
		release: jest.fn(),
		query: jest.fn(async (sql) => {
			const s = sql.trim()
			if (s.startsWith('SELECT GET_LOCK')) {
				if (
					lockState.heldBy === null ||
					lockState.heldBy === id
				) {
					lockState.heldBy = id
					return [[{ locked: 1 }]]
				}
				return [[{ locked: 0 }]]
			}
			if (s.startsWith('SELECT RELEASE_LOCK')) {
				if (lockState.heldBy === id) {
					lockState.heldBy = null
					return [[{ released: 1 }]]
				}
				// Real MySQL: releasing from a different session than the
				// one holding the lock does NOT release it.
				return [[{ released: 0 }]]
			}
			if (failOn && s.startsWith(failOn)) {
				throw new Error('simulated insert failure')
			}
			if (s.startsWith('INSERT INTO events')) {
				return [{ insertId: 900 + id }]
			}
			if (s.startsWith('INSERT INTO trivia_questions')) {
				return [
					{
						insertId: nextQuestionIdRef.current++,
					},
				]
			}
			return [{ affectedRows: 1 }]
		}),
	}
}

// SQL-sniffing db mock — the rotation job issues many different queries
// through the same pool, so branching on the SQL text (rather than a long
// mockResolvedValueOnce chain) keeps this readable as the call count grows.
//
// `db.getConnection()` hands out a fresh makeSmartConn() each call (like a
// real pool would) and records them in `db.connections`, in call order —
// runRotation always grabs the lock connection first (db.connections[0]),
// so any later connections (db.connections[1], [2], ...) are per-event
// work connections from createProceduralEvents.
// Mimics the eligible-question query, but only applies each filter when
// the SQL actually contains it — so dropping a WHERE clause from the real
// query makes these tests fail rather than silently pass.
function eligibleQuestionRows(triviaQuestions, sql, params) {
	return triviaQuestions
		.filter(
			(q) =>
				!sql.includes(
					"curation_status = 'PUBLISHED'"
				) || q.curation_status === 'PUBLISHED'
		)
		.filter(
			(q) =>
				!sql.includes('is_procedural = FALSE') ||
				!q.is_procedural
		)
		.filter(
			(q) =>
				!sql.includes('format IN (?)') ||
				params[0].includes(q.format)
		)
		.map(({ question_id, format, body }) => ({
			question_id,
			format,
			body,
		}))
}

function optionRowsFor(triviaQuestions, questionIds) {
	return triviaQuestions
		.filter((q) => questionIds.includes(q.question_id))
		.flatMap((q) =>
			(q.options ?? []).map((o) => ({
				question_id: q.question_id,
				...o,
			}))
		)
}

let nextFakeQuestionId = 1
function fakeQuestion(body, overrides = {}) {
	return {
		question_id: nextFakeQuestionId++,
		format: 'MULTIPLE_CHOICE',
		body,
		curation_status: 'PUBLISHED',
		is_procedural: false,
		options: [
			{ body: `${body} (right)`, is_correct: true },
			{ body: `${body} (wrong)`, is_correct: false },
		],
		...overrides,
	}
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)

async function pickTexts(db, seed) {
	const picks = await pickPopupQuestions(db, { rng: createRng(seed) })
	return picks.map((q) => q.text)
}

function makeDb({
	lockAcquired = true,
	authorId = 42,
	activeEvents = [],
	recentSpots = [],
	zoneLastUsed = [],
	// Existing questions in the fake DB: [{question_id, format, body,
	// curation_status, is_procedural, options: [{body, is_correct}]}].
	triviaQuestions = [],
	cards = [
		{ card_id: 1, rarity: 'COMMON' },
		{ card_id: 2, rarity: 'UNCOMMON' },
		{ card_id: 3, rarity: 'RARE' },
		{ card_id: 4, rarity: 'EPIC' },
	],
	recentBodies = [],
	retiredAffectedRows = 0,
	failOn = null,
	// Shared, mutable "who holds the named lock" state — pass the SAME
	// object across two makeDb() calls (or reuse one db across two
	// runRotation() calls) to simulate a persistent MySQL server seeing
	// both ticks, the way the real GET_LOCK/RELEASE_LOCK pair would.
	lockState = { heldBy: lockAcquired ? null : '__externally_held__' },
} = {}) {
	let nextConnId = 1
	const connections = []
	const nextQuestionIdRef = { current: 1 }

	const query = jest.fn(async (sql, params = []) => {
		const s = sql.trim()
		if (s.includes('UPDATE events') && s.includes('RETIRED'))
			return [{ affectedRows: retiredAffectedRows }]
		if (s.includes('FROM admin_roles'))
			return [authorId != null ? [{ user_id: authorId }] : []]
		if (s.includes('is_active = TRUE')) return [activeEvents]
		if (
			s.includes('ORDER BY created_at DESC') &&
			s.includes('latitude')
		)
			return [recentSpots]
		if (s.includes('placement_zone, MAX(created_at)'))
			return [zoneLastUsed]
		if (s.includes('JOIN events e ON e.event_id = tq.event_id'))
			return [
				eligibleQuestionRows(
					triviaQuestions,
					s,
					params
				),
			]
		if (s.includes('FROM trivia_options'))
			return [optionRowsFor(triviaQuestions, params[0])]
		if (s.includes('recent ON recent.event_id'))
			return [recentBodies]
		if (s.includes('SELECT card_id, rarity FROM cards'))
			return [cards]
		if (s.startsWith('INSERT INTO placement_runs'))
			return [{ insertId: 1 }]
		return [[]]
	})
	const getConnection = jest.fn(async () => {
		const conn = makeSmartConn({
			id: nextConnId++,
			lockState,
			failOn,
			nextQuestionIdRef,
		})
		connections.push(conn)
		return conn
	})
	return { query, getConnection, connections, lockState }
}

describe('runRotation — locking', () => {
	test('lock not acquired means nothing happens', async () => {
		const db = makeDb({ lockAcquired: false })
		const result = await runRotation(db, { rng: createRng(1) })

		expect(result).toEqual({
			skipped: true,
			reason: 'LOCK_NOT_ACQUIRED',
		})
		// Still checks out (and releases) exactly one connection to make
		// the GET_LOCK attempt — it just never gets past that.
		expect(db.connections).toHaveLength(1)
		expect(db.connections[0].release).toHaveBeenCalledTimes(1)
		expect(db.query).not.toHaveBeenCalled()
	})

	test('lock is released even when the run throws', async () => {
		const db = makeDb()
		db.query.mockImplementation(async (sql) => {
			const s = sql.trim()
			if (
				s.includes('UPDATE events') &&
				s.includes('RETIRED')
			)
				throw new Error('boom')
			if (s.startsWith('INSERT INTO placement_runs'))
				return [{ insertId: 1 }]
			return [[]]
		})

		const result = await runRotation(db, { rng: createRng(1) })

		expect(result.status).toBe('FAILED')
		expect(result.error).toMatch(/boom/)

		const lockConn = db.connections[0]
		const releaseCalled = lockConn.query.mock.calls.some(([sql]) =>
			sql.trim().startsWith('SELECT RELEASE_LOCK')
		)
		expect(releaseCalled).toBe(true)
		expect(lockConn.release).toHaveBeenCalledTimes(1)

		const runLogged = db.query.mock.calls.some(([sql]) =>
			sql.trim().startsWith('INSERT INTO placement_runs')
		)
		expect(runLogged).toBe(true)
	})

	test('GET_LOCK and RELEASE_LOCK run on the same connection', async () => {
		const db = makeDb({ authorId: null }) // short-circuits quickly, no events to create
		await runRotation(db, { rng: createRng(1) })

		// Exactly one connection was checked out for the lock, and it's
		// the SAME object instance that issued both calls — not two
		// different pooled connections.
		expect(db.connections).toHaveLength(1)
		const lockConn = db.connections[0]
		const calls = lockConn.query.mock.calls.map(([sql]) =>
			sql.trim()
		)
		expect(
			calls.some((sql) => sql.startsWith('SELECT GET_LOCK'))
		).toBe(true)
		expect(
			calls.some((sql) =>
				sql.startsWith('SELECT RELEASE_LOCK')
			)
		).toBe(true)
		expect(lockConn.release).toHaveBeenCalledTimes(1)
	})

	test('calling runRotation twice in a row succeeds both times (not SKIPPED the second time)', async () => {
		// Same db (and therefore the same shared lockState) across two
		// separate runRotation calls, simulating two ticks against one
		// persistent MySQL server. If RELEASE_LOCK ran on the wrong
		// connection, the lock would stay held and the second call would
		// come back {skipped: true, reason: 'LOCK_NOT_ACQUIRED'}.
		const db = makeDb({ authorId: null })

		const first = await runRotation(db, { rng: createRng(1) })
		const second = await runRotation(db, { rng: createRng(2) })

		expect(first.skipped).toBeUndefined()
		expect(second.skipped).toBeUndefined()
		expect(first.status).toBe('SKIPPED') // no author configured — a
		expect(second.status).toBe('SKIPPED') // different, expected reason
		expect(db.lockState.heldBy).toBeNull()
	})
})

describe('retireExpiredEvents', () => {
	test('retires procedural events past their TTL, curation-style', async () => {
		const db = makeDb({ retiredAffectedRows: 5 })
		const count = await retireExpiredEvents(db, {
			now: new Date(2000, 0, 1),
		})
		expect(count).toBe(5)
		const [sql, params] = db.query.mock.calls[0]
		expect(sql).toMatch(/is_active = FALSE/)
		expect(sql).toMatch(/curation_status = 'RETIRED'/)
		expect(sql).toMatch(/retired_at = \?/)
		expect(sql).toMatch(/is_procedural = TRUE/)
		expect(params).toHaveLength(2)
	})
})

describe('resolveAuthorId', () => {
	const OLD_ENV = process.env.PLACEMENT_AUTHOR_ID

	afterEach(() => {
		if (OLD_ENV === undefined)
			delete process.env.PLACEMENT_AUTHOR_ID
		else process.env.PLACEMENT_AUTHOR_ID = OLD_ENV
	})

	test('prefers PLACEMENT_AUTHOR_ID when set', async () => {
		process.env.PLACEMENT_AUTHOR_ID = '7'
		const db = makeDb()
		expect(await resolveAuthorId(db)).toBe(7)
		expect(db.query).not.toHaveBeenCalled()
	})

	test('falls back to the first SUPER_ADMIN', async () => {
		delete process.env.PLACEMENT_AUTHOR_ID
		const db = makeDb({ authorId: 99 })
		expect(await resolveAuthorId(db)).toBe(99)
	})

	test('returns null when no author is configured or found', async () => {
		delete process.env.PLACEMENT_AUTHOR_ID
		const db = makeDb({ authorId: null })
		expect(await resolveAuthorId(db)).toBeNull()
	})
})

describe('pickPopupQuestions', () => {
	test('avoids questions used by recent pop-up events', async () => {
		const db = makeDb({
			recentBodies: [
				{
					body: 'In which South African city is the University of the Witwatersrand located?',
				},
			],
		})
		const picks = await pickPopupQuestions(db, {
			rng: createRng(1),
		})
		expect(picks).toHaveLength(2)
		expect(
			picks.some((q) =>
				q.text.startsWith('In which South African city')
			)
		).toBe(false)
	})

	test('falls back to the full pool when too few fresh questions remain', async () => {
		// Exclude everything by echoing back the whole starter bank as
		// "recently used" — with < 2 eligible left, it must still return 2.
		const wholeBank = Array.from({ length: 10 }, (_, i) => ({
			body: `placeholder ${i}`,
		}))
		const db = makeDb({ recentBodies: wholeBank })
		const picks = await pickPopupQuestions(db, {
			rng: createRng(2),
		})
		expect(picks).toHaveLength(2)
	})
})

describe('pickPopupQuestions — existing DB questions', () => {
	test('only picks questions from PUBLISHED events (no drafts, in-review, retired or archived)', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('published A'),
				fakeQuestion('published B'),
				fakeQuestion('draft', {
					curation_status: 'DRAFT',
				}),
				fakeQuestion('in review', {
					curation_status: 'IN_REVIEW',
				}),
				fakeQuestion('retired', {
					curation_status: 'RETIRED',
				}),
				fakeQuestion('archived', {
					curation_status: 'ARCHIVED',
				}),
			],
		})
		for (const seed of SEEDS) {
			expect((await pickTexts(db, seed)).sort()).toEqual([
				'published A',
				'published B',
			])
		}
	})

	test('never picks questions belonging to procedural events', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('curated A'),
				fakeQuestion('curated B'),
				fakeQuestion('pop-up copy 1', {
					is_procedural: true,
				}),
				fakeQuestion('pop-up copy 2', {
					is_procedural: true,
				}),
			],
		})
		for (const seed of SEEDS) {
			expect((await pickTexts(db, seed)).sort()).toEqual([
				'curated A',
				'curated B',
			])
		}
	})

	test('avoids DB questions used by recent pop-up events', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('used recently'),
				fakeQuestion('fresh A'),
				fakeQuestion('fresh B'),
			],
			recentBodies: [{ body: '  Used Recently ' }],
		})
		for (const seed of SEEDS) {
			expect((await pickTexts(db, seed)).sort()).toEqual([
				'fresh A',
				'fresh B',
			])
		}
	})

	test('does not touch the JSON fallback when the DB has 2+ eligible questions', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('db A'),
				fakeQuestion('db B'),
				fakeQuestion('db C'),
			],
		})
		for (const seed of SEEDS) {
			const picks = await pickPopupQuestions(db, {
				rng: createRng(seed),
			})
			expect(picks).toHaveLength(2)
			expect(picks.every((q) => q.id.startsWith('db:'))).toBe(
				true
			)
		}
	})

	test('tops up from popup_questions.json when only 1 eligible DB question exists', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('only one'),
				fakeQuestion('draft', {
					curation_status: 'DRAFT',
				}),
			],
		})
		const picks = await pickPopupQuestions(db, {
			rng: createRng(1),
		})
		expect(picks).toHaveLength(2)
		expect(picks.map((q) => q.id.split(':')[0]).sort()).toEqual([
			'db',
			'json',
		])
		expect(picks.some((q) => q.text === 'only one')).toBe(true)
	})

	test('uses the JSON fallback entirely when the DB has no eligible questions', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('draft', {
					curation_status: 'DRAFT',
				}),
				fakeQuestion('copy', { is_procedural: true }),
			],
		})
		const picks = await pickPopupQuestions(db, {
			rng: createRng(1),
		})
		expect(picks).toHaveLength(2)
		expect(picks.every((q) => q.id.startsWith('json:'))).toBe(true)
	})

	test('skips formats and questions it cannot copy faithfully', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('multi select', {
					format: 'MULTIPLE_SELECT',
				}),
				fakeQuestion('no options', { options: [] }),
				fakeQuestion('good A'),
				fakeQuestion('good B'),
			],
		})
		for (const seed of SEEDS) {
			expect((await pickTexts(db, seed)).sort()).toEqual([
				'good A',
				'good B',
			])
		}
	})

	test('the same question on several events is only offered once', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('duplicated'),
				fakeQuestion('duplicated'),
			],
		})
		for (const seed of SEEDS) {
			const texts = await pickTexts(db, seed)
			expect(texts).toHaveLength(2)
			expect(new Set(texts).size).toBe(2)
		}
	})

	test('never queries is_popup_template', async () => {
		const db = makeDb({
			triviaQuestions: [fakeQuestion('a'), fakeQuestion('b')],
		})
		await pickPopupQuestions(db, { rng: createRng(1) })
		for (const [sql] of db.query.mock.calls) {
			expect(sql).not.toMatch(/is_popup_template/)
		}
	})
})

describe('pickPopupCards', () => {
	test('picks between 1 and 3 distinct cards', async () => {
		const db = makeDb()
		for (const seed of [1, 2, 3, 4, 5]) {
			const picks = await pickPopupCards(db, {
				rng: createRng(seed),
			})
			expect(picks.length).toBeGreaterThanOrEqual(1)
			expect(picks.length).toBeLessThanOrEqual(3)
			expect(new Set(picks).size).toBe(picks.length)
		}
	})

	test('weights picks by rarity — commons come up far more than legendaries', async () => {
		const cards = [
			{ card_id: 1, rarity: 'COMMON' },
			{ card_id: 2, rarity: 'COMMON' },
			{ card_id: 3, rarity: 'UNCOMMON' },
			{ card_id: 4, rarity: 'RARE' },
			{ card_id: 5, rarity: 'EPIC' },
			{ card_id: 6, rarity: 'LEGENDARY' },
		]
		const db = makeDb({ cards })

		let commonHits = 0
		let legendaryHits = 0
		const trials = 200
		for (let seed = 1; seed <= trials; seed++) {
			const picks = await pickPopupCards(db, {
				rng: createRng(seed),
			})
			if (picks.includes(1) || picks.includes(2)) commonHits++
			if (picks.includes(6)) legendaryHits++
		}

		expect(commonHits).toBeGreaterThan(legendaryHits * 3)
	})
})

describe('runRotation — placement', () => {
	test('never creates more events than maxLive', async () => {
		const db = makeDb()
		const result = await runRotation(db, {
			config: { maxLive: 2 },
			rng: createRng(1),
			now: new Date(2026, 0, 1),
			graph: FIXTURE_GRAPH,
		})
		expect(result.status).toBe('SUCCESS')
		expect(result.createdCount).toBeLessThanOrEqual(2)
		expect(result.createdCount).toBeGreaterThan(0)
	})

	test('each new event gets 2 questions and 1-3 cards', async () => {
		const db = makeDb()
		await runRotation(db, {
			config: { maxLive: 1 },
			rng: createRng(1),
			now: new Date(2026, 0, 1),
			graph: FIXTURE_GRAPH,
		})

		// db.connections[0] is the lock connection; [1] is the one event
		// this run creates (maxLive: 1).
		const eventConn = db.connections[1]
		const questionInserts = eventConn.query.mock.calls.filter(
			([sql]) =>
				sql
					.trim()
					.startsWith(
						'INSERT INTO trivia_questions'
					)
		)
		const cardInserts = eventConn.query.mock.calls.filter(([sql]) =>
			sql.trim().startsWith('INSERT INTO event_card_pool')
		)
		expect(questionInserts).toHaveLength(2)
		expect(cardInserts.length).toBeGreaterThanOrEqual(1)
		expect(cardInserts.length).toBeLessThanOrEqual(3)
		expect(eventConn.commit).toHaveBeenCalledTimes(1)
	})

	test('each pop-up gets exactly 2 DB questions, copied with their options', async () => {
		const db = makeDb({
			triviaQuestions: [
				fakeQuestion('q1'),
				fakeQuestion('q2'),
				fakeQuestion('q3'),
			],
		})
		const result = await runRotation(db, {
			config: { maxLive: 3 },
			rng: createRng(1),
			now: new Date(2026, 0, 1),
			graph: FIXTURE_GRAPH,
		})
		expect(result.createdCount).toBeGreaterThan(0)

		const eventConns = db.connections.slice(1)
		expect(eventConns).toHaveLength(result.createdCount)
		for (const conn of eventConns) {
			const calls = conn.query.mock.calls
			const questionInserts = calls.filter(([sql]) =>
				sql
					.trim()
					.startsWith(
						'INSERT INTO trivia_questions'
					)
			)
			expect(questionInserts).toHaveLength(2)
			for (const [, [, format, body]] of questionInserts) {
				expect(format).toBe('MULTIPLE_CHOICE')
				expect(['q1', 'q2', 'q3']).toContain(body)
			}

			const optionInserts = calls.filter(([sql]) =>
				sql
					.trim()
					.startsWith(
						'INSERT INTO trivia_options'
					)
			)
			// 2 options per copied question, exactly one correct each.
			expect(optionInserts).toHaveLength(4)
			expect(
				optionInserts.filter(
					([, [, , correct]]) => correct
				)
			).toHaveLength(2)
		}
	})

	test('a failed insert rolls back that event and does not fail the run', async () => {
		const db = makeDb({ failOn: 'INSERT INTO trivia_options' })

		const result = await runRotation(db, {
			config: { maxLive: 1 },
			rng: createRng(1),
			now: new Date(2026, 0, 1),
			graph: FIXTURE_GRAPH,
		})

		const eventConn = db.connections[1]
		expect(eventConn.rollback).toHaveBeenCalledTimes(1)
		expect(eventConn.commit).not.toHaveBeenCalled()
		expect(eventConn.release).toHaveBeenCalledTimes(1)
		expect(result.status).toBe('SUCCESS')
		expect(result.createdCount).toBe(0)
	})

	test('skips event creation with a clear error when no author is found', async () => {
		const savedEnv = process.env.PLACEMENT_AUTHOR_ID
		delete process.env.PLACEMENT_AUTHOR_ID
		try {
			const db = makeDb({ authorId: null })
			const result = await runRotation(db, {
				rng: createRng(1),
			})

			expect(result.status).toBe('SKIPPED')
			expect(result.error).toMatch(/no SUPER_ADMIN found/)
			// Only the lock connection was ever checked out — no event
			// connections, since there's no author to create events with.
			expect(db.connections).toHaveLength(1)
		} finally {
			if (savedEnv === undefined)
				delete process.env.PLACEMENT_AUTHOR_ID
			else process.env.PLACEMENT_AUTHOR_ID = savedEnv
		}
	})

	test('logs a placement_runs row for the run', async () => {
		const db = makeDb({ retiredAffectedRows: 3 })
		await runRotation(db, {
			config: { maxLive: 1 },
			rng: createRng(1),
			now: new Date(2026, 0, 1),
			graph: FIXTURE_GRAPH,
		})

		const runInsert = db.query.mock.calls.find(([sql]) =>
			sql.trim().startsWith('INSERT INTO placement_runs')
		)
		expect(runInsert).toBeDefined()
		const [, params] = runInsert
		const [, , retiredCount, createdCount, status] = params
		expect(retiredCount).toBe(3)
		expect(createdCount).toBeGreaterThanOrEqual(0)
		expect(status).toBe('SUCCESS')
	})
})

describe('isRotationDue', () => {
	test('never run before -> due', async () => {
		const db = { query: jest.fn(async () => [[]]) }
		expect(
			await isRotationDue(db, { rotationIntervalMinutes: 15 })
		).toBe(true)
	})

	test('last SUCCESS run started recently -> not due', async () => {
		const now = new Date('2026-01-01T00:20:00Z')
		const db = {
			query: jest.fn(async () => [
				[{ started_at: '2026-01-01T00:10:00Z' }],
			]),
		}
		expect(
			await isRotationDue(db, {
				now,
				rotationIntervalMinutes: 15,
			})
		).toBe(false)
	})

	test('last SUCCESS run started rotationIntervalMinutes+ ago -> due', async () => {
		const now = new Date('2026-01-01T00:30:00Z')
		const db = {
			query: jest.fn(async () => [
				[{ started_at: '2026-01-01T00:10:00Z' }],
			]),
		}
		expect(
			await isRotationDue(db, {
				now,
				rotationIntervalMinutes: 15,
			})
		).toBe(true)
	})

	test('only ever considers SUCCESS runs', async () => {
		const db = { query: jest.fn(async () => [[]]) }
		await isRotationDue(db, { rotationIntervalMinutes: 15 })
		expect(db.query.mock.calls[0][0]).toMatch(/status = 'SUCCESS'/)
	})
})

describe('maybeRunRotation (scheduler tick)', () => {
	test('runs a rotation when due', async () => {
		// makeDb's default query sniffer has no placement_runs branch, so
		// it falls through to "no rows" -> isRotationDue -> true (due).
		const db = makeDb({ authorId: null })
		await maybeRunRotation(db, DEFAULT_CONFIG)
		// The lock connection being checked out proves runRotation actually
		// executed, not just that isRotationDue was checked.
		expect(db.connections.length).toBeGreaterThan(0)
	})

	test('does nothing when not due', async () => {
		const db = {
			query: jest.fn(async (sql) =>
				sql.includes('placement_runs')
					? [
							[
								{
									started_at: new Date().toISOString(),
								},
							],
						]
					: [[]]
			),
			getConnection: jest.fn(),
		}
		await maybeRunRotation(db, DEFAULT_CONFIG)
		expect(db.getConnection).not.toHaveBeenCalled()
	})

	test('catches and logs a failing tick instead of throwing', async () => {
		const db = {
			query: jest.fn(async () => {
				throw new Error('tick boom')
			}),
		}
		const errSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {})

		await expect(
			maybeRunRotation(db, DEFAULT_CONFIG)
		).resolves.toBeUndefined()
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'[placement] scheduler tick failed'
			),
			expect.any(String)
		)
		errSpy.mockRestore()
	})
})

describe('startRotationScheduler', () => {
	test('always starts an interval — no flag to disable it', async () => {
		const db = makeDb({ authorId: null })
		const timer = startRotationScheduler(db, DEFAULT_CONFIG)
		expect(timer).not.toBeNull()
		clearInterval(timer)
		// let the immediate first tick's promise chain settle before
		// leaving the test, so it doesn't bleed into the next one
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))
	})

	test('ticks once immediately, so a fresh server fills the map right away', async () => {
		const db = makeDb({ authorId: null })
		const timer = startRotationScheduler(db, DEFAULT_CONFIG)
		clearInterval(timer)
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(db.connections.length).toBeGreaterThan(0)
	})

	test('a throwing tick does not crash the scheduler', async () => {
		const throwingDb = {
			query: jest.fn(async () => {
				throw new Error('boom')
			}),
		}
		const errSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {})

		const timer = startRotationScheduler(throwingDb, DEFAULT_CONFIG)
		clearInterval(timer)
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(errSpy).toHaveBeenCalled()
		errSpy.mockRestore()
	})
})
