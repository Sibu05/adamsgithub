import { jest } from '@jest/globals'

const createPool = jest.fn(() => ({
	query: jest.fn(),
	execute: jest.fn(),
}))
jest.unstable_mockModule('mysql2/promise', () => ({
	default: { createPool },
}))

await import('./db.js')

describe('shared DB pool', () => {
	test('reads and writes DATETIMEs as UTC, not the server’s local time', () => {
		// All DATETIME columns hold UTC. With mysql2's default
		// ('local'), a SAST machine reads them 2 h early: the placement
		// rotation looked overdue on every 60 s tick, and live pop-ups
		// reported "This event has ended."
		expect(createPool).toHaveBeenCalledTimes(1)
		expect(createPool.mock.calls[0][0].timezone).toBe('Z')
	})
})
