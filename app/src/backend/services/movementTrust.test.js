import { jest } from '@jest/globals'

import {
	analyzeMovement,
	assessMovement,
	JITTER_TOLERANCE_M,
	WALKING_SPEED_THRESHOLD_MPS,
} from './movementTrust.js'

// ~Great Hall. 1° of latitude ≈ 111.2 km, so 0.009° ≈ 1 km.
const GH = { lat: -26.19089, lng: 28.0271 }

// Fake db whose single SELECT returns `prev` (or nothing).
function dbWithPrev(prev) {
	return { query: jest.fn(async () => [prev ? [prev] : []]) }
}

function prevAt(point, elapsed_seconds, check_id = 10) {
	return {
		check_id,
		claimed_lat: String(point.lat), // DECIMAL columns arrive as strings
		claimed_lng: String(point.lng),
		elapsed_seconds,
	}
}

describe('analyzeMovement', () => {
	test('flags 2 km in 30 s', async () => {
		const db = dbWithPrev(prevAt(GH, 30))
		const r = await analyzeMovement(db, 1, GH.lat - 0.018, GH.lng)
		expect(r.isSuspicious).toBe(true)
		expect(r.prevCheckId).toBe(10)
		expect(r.travelSpeedMps).toBeGreaterThan(60)
	})

	test('does not flag a normal walk (300 m in 5 min)', async () => {
		const db = dbWithPrev(prevAt(GH, 300))
		const r = await analyzeMovement(db, 1, GH.lat - 0.0027, GH.lng)
		expect(r.isSuspicious).toBe(false)
		expect(r.travelSpeedMps).toBeCloseTo(1, 0)
		expect(r.prevCheckId).toBe(10)
	})

	test('does not flag GPS jitter (~10 m in 2 s)', async () => {
		const db = dbWithPrev(prevAt(GH, 2))
		const r = await analyzeMovement(db, 1, GH.lat + 0.00009, GH.lng)
		expect(r.isSuspicious).toBe(false)
	})

	test('does not flag a double submit (same spot, 0 s apart) and never divides by zero', async () => {
		const db = dbWithPrev(prevAt(GH, 0))
		const r = await analyzeMovement(db, 1, GH.lat, GH.lng)
		expect(r.isSuspicious).toBe(false)
		expect(Number.isFinite(r.travelSpeedMps)).toBe(true)
		expect(r.travelSpeedMps).toBe(0)
	})

	test('does not flag the first-ever check (no previous)', async () => {
		const db = dbWithPrev(null)
		const r = await analyzeMovement(db, 1, GH.lat, GH.lng)
		expect(r).toEqual({
			prevCheckId: null,
			travelSpeedMps: null,
			isSuspicious: false,
		})
	})

	test('skips the lookup when the current position is missing or 0,0 (QR fallback)', async () => {
		const db = dbWithPrev(prevAt(GH, 30))
		expect(
			(await analyzeMovement(db, 1, NaN, NaN)).isSuspicious
		).toBe(false)
		expect((await analyzeMovement(db, 1, 0, 0)).isSuspicious).toBe(
			false
		)
		expect(db.query).not.toHaveBeenCalled()
	})

	test('only compares against VERIFIED checks with real coordinates, for this user', async () => {
		const db = dbWithPrev(null)
		await analyzeMovement(db, 42, GH.lat, GH.lng)
		const [sql, params] = db.query.mock.calls[0]
		expect(sql).toMatch(/status = 'VERIFIED'/)
		expect(sql).toMatch(
			/NOT \(claimed_lat = 0 AND claimed_lng = 0\)/
		)
		expect(params).toEqual([42])
	})
})

describe('assessMovement', () => {
	test('a teleport inside a 0 s gap is still flagged', () => {
		expect(assessMovement(500, 0).isSuspicious).toBe(true)
	})

	test('distance just under the jitter tolerance is never flagged, even at speed', () => {
		expect(
			assessMovement(JITTER_TOLERANCE_M - 1, 1).isSuspicious
		).toBe(false)
	})

	test('flags just above the walking threshold, not at it', () => {
		const t = 100
		expect(
			assessMovement(WALKING_SPEED_THRESHOLD_MPS * t, t)
				.isSuspicious
		).toBe(false)
		expect(
			assessMovement(WALKING_SPEED_THRESHOLD_MPS * t + 5, t)
				.isSuspicious
		).toBe(true)
	})
})
