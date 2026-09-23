import { jest } from '@jest/globals'

jest.unstable_mockModule('./db.js', () => ({
	default: {
		query: jest.fn(),
	},
}))

const { default: pool } = await import('./db.js')
const {
	BATTLE_DECK_NO_CARDS,
	valid_user_cards,
	get_active_battle,
	abandon_battle,
	abandon_stale_battles,
} = await import('./battle.js')

// ── Fixtures ────────────────────────────────────────────────

const USER = { user_id: 7 }

function makeDeck(count = BATTLE_DECK_NO_CARDS) {
	return Array.from({ length: count }, (_, i) => ({ card_id: i + 1 }))
}

function ownedRows(rarities) {
	return rarities.map((rarity, i) => ({ card_id: i + 1, rarity }))
}

beforeEach(() => {
	pool.query.mockReset()
})

// ── Tests ───────────────────────────────────────────────────

describe('valid_user_cards', () => {
	test.each([
		['not an array', null],
		['too few cards', makeDeck(4)],
		['too many cards', makeDeck(6)],
	])('rejects a deck that is %s without querying', async (_, deck) => {
		expect(await valid_user_cards(USER, deck)).toBe(false)
		expect(pool.query).not.toHaveBeenCalled()
	})

	test('checks ownership of every card for this user', async () => {
		pool.query.mockResolvedValueOnce([
			ownedRows([
				'COMMON',
				'RARE',
				'COMMON',
				'EPIC',
				'COMMON',
			]),
		])
		expect(await valid_user_cards(USER, makeDeck())).toBe(true)

		const [sql, params] = pool.query.mock.calls[0]
		expect(sql).toMatch(
			/IN \(\?,\?,\?,\?,\?\) AND uc\.user_id = \?/
		)
		expect(params).toEqual([1, 2, 3, 4, 5, USER.user_id])
	})

	test('rejects when any card is not owned', async () => {
		pool.query.mockResolvedValueOnce([
			ownedRows(['COMMON', 'COMMON', 'COMMON', 'COMMON']),
		])
		expect(await valid_user_cards(USER, makeDeck())).toBe(false)
	})

	test('allows exactly one LEGENDARY card', async () => {
		pool.query.mockResolvedValueOnce([
			ownedRows([
				'LEGENDARY',
				'COMMON',
				'COMMON',
				'COMMON',
				'RARE',
			]),
		])
		expect(await valid_user_cards(USER, makeDeck())).toBe(true)
	})

	test('rejects more than one LEGENDARY card', async () => {
		pool.query.mockResolvedValueOnce([
			ownedRows([
				'LEGENDARY',
				'COMMON',
				'LEGENDARY',
				'COMMON',
				'RARE',
			]),
		])
		expect(await valid_user_cards(USER, makeDeck())).toBe(false)
	})
})

describe('get_active_battle', () => {
	test('returns the active battle id', async () => {
		pool.query.mockResolvedValueOnce([[{ battle_id: 12 }], []])
		expect(await get_active_battle(3)).toBe(12)
		expect(pool.query.mock.calls[0][1]).toEqual([3, 3])
	})

	test('returns null when the user has no active battle', async () => {
		pool.query.mockResolvedValueOnce([[], []])
		expect(await get_active_battle(3)).toBeNull()
	})

	test('returns null when the query fails', async () => {
		pool.query.mockRejectedValueOnce(new Error('db down'))
		expect(await get_active_battle(3)).toBeNull()
	})
})

describe('abandon_battle', () => {
	test('marks the battle abandoned with no winner', async () => {
		pool.query.mockResolvedValueOnce([
			{ affectedRows: 1 },
			undefined,
		])
		await abandon_battle(9)
		const [sql, params] = pool.query.mock.calls[0]
		expect(sql).toMatch(/SET status = 'ABANDONED'/)
		expect(params).toEqual([null, 9])
	})

	test('returns false when the query fails', async () => {
		pool.query.mockRejectedValueOnce(new Error('db down'))
		expect(await abandon_battle(9)).toBe(false)
	})
})

describe('abandon_stale_battles', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => {})
		jest.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		console.log.mockRestore()
		console.error.mockRestore()
	})

	test('abandons every PENDING/ACTIVE battle and returns the count', async () => {
		pool.query.mockResolvedValueOnce([{ affectedRows: 4 }])
		expect(await abandon_stale_battles()).toBe(4)
		expect(pool.query.mock.calls[0][0]).toMatch(
			/WHERE status IN \('PENDING', 'ACTIVE'\)/
		)
		expect(console.log).toHaveBeenCalledWith(
			'[Server Startup] Cleaned up 4 unresolved battle(s).'
		)
	})

	test('logs and rethrows on failure', async () => {
		const err = new Error('db down')
		pool.query.mockRejectedValueOnce(err)
		await expect(abandon_stale_battles()).rejects.toBe(err)
		expect(console.error).toHaveBeenCalled()
	})
})
