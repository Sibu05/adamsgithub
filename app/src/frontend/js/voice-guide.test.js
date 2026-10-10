import { jest } from '@jest/globals'

import {
	estimateWalkSeconds,
	formatWalkTime,
	buildEventAnnouncement,
	isMuted,
	toggleMute,
} from './voice-guide.js'

// ── estimateWalkSeconds ─────────────────────────────────────

describe('estimateWalkSeconds', () => {
	test('returns null for null / invalid / negative distances', () => {
		expect(estimateWalkSeconds(null)).toBeNull()
		expect(estimateWalkSeconds(undefined)).toBeNull()
		expect(estimateWalkSeconds(NaN)).toBeNull()
		expect(estimateWalkSeconds(-5)).toBeNull()
		expect(estimateWalkSeconds('not a number')).toBeNull()
	})

	test('returns 0 for 0 metres', () => {
		expect(estimateWalkSeconds(0)).toBe(0)
	})

	test('uses 1.4 m/s as the walking speed', () => {
		// 140m at 1.4 m/s = 100 seconds
		expect(estimateWalkSeconds(140)).toBe(100)
		// 84m at 1.4 m/s = 60 seconds
		expect(estimateWalkSeconds(84)).toBe(60)
	})
})

// ── formatWalkTime ──────────────────────────────────────────

describe('formatWalkTime', () => {
	test('returns null for null', () => {
		expect(formatWalkTime(null)).toBeNull()
	})

	test('short walks read "under a minute"', () => {
		expect(formatWalkTime(0)).toBe('under a minute')
		expect(formatWalkTime(29)).toBe('under a minute')
	})

	test('around a minute reads "about a minute"', () => {
		expect(formatWalkTime(30)).toBe('about a minute')
		expect(formatWalkTime(89)).toBe('about a minute')
	})

	test('minutes round sensibly', () => {
		expect(formatWalkTime(90)).toBe('about 2 minutes')
		expect(formatWalkTime(180)).toBe('about 3 minutes')
		expect(formatWalkTime(60 * 59)).toBe('about 59 minutes')
	})

	test('over an hour switches to hours', () => {
		expect(formatWalkTime(60 * 60)).toBe('about an hour')
		expect(formatWalkTime(60 * 60 * 2)).toBe('about 2 hours')
	})
})

// ── buildEventAnnouncement ──────────────────────────────────

describe('buildEventAnnouncement', () => {
	const baseEvent = { title: 'Great Hall' }

	test('no distance available — says so', () => {
		const text = buildEventAnnouncement(baseEvent, {
			distanceM: null,
			status: 'ACTIVE',
		})
		expect(text).toContain('Great Hall')
		expect(text).toMatch(/don't have your location/i)
	})

	test('in-range event mentions the player can attempt', () => {
		const text = buildEventAnnouncement(baseEvent, {
			distanceM: 20,
			status: 'ACTIVE',
			canAttempt: true,
		})
		expect(text).toContain('Great Hall')
		expect(text).toMatch(/close enough to attempt/i)
	})

	test('out-of-range event mentions distance and walk time', () => {
		const text = buildEventAnnouncement(baseEvent, {
			distanceM: 250,
			status: 'ACTIVE',
			canAttempt: false,
		})
		expect(text).toContain('Great Hall')
		expect(text).toContain('250m')
		expect(text).toMatch(/walk there/i)
	})

	test('expired event overrides distance messaging', () => {
		const text = buildEventAnnouncement(baseEvent, {
			distanceM: 250,
			status: 'EXPIRED',
		})
		expect(text).toMatch(/already ended/i)
	})

	test('upcoming event still mentions distance', () => {
		const text = buildEventAnnouncement(baseEvent, {
			distanceM: 250,
			status: 'UPCOMING',
		})
		expect(text).toMatch(/hasn't started/i)
		expect(text).toContain('250m')
	})

	test('falls back to a generic title if missing', () => {
		const text = buildEventAnnouncement(
			{},
			{ distanceM: null, status: 'ACTIVE' }
		)
		expect(text).toContain('This event')
	})
})

// ── Mute toggle (localStorage-backed) ───────────────────────

describe('mute toggle', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	test('defaults to unmuted', () => {
		expect(isMuted()).toBe(false)
	})

	test('toggleMute flips state and persists', () => {
		expect(toggleMute()).toBe(true)
		expect(isMuted()).toBe(true)
		expect(toggleMute()).toBe(false)
		expect(isMuted()).toBe(false)
	})
})
