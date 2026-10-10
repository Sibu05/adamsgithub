import { jest } from '@jest/globals'
import {
	resolve_better_auth_user,
	PIN_ACCOUNT_CONFLICT,
} from './better_auth_sync.js'

const googleUser = {
	id: 'ba_123',
	email: 'thandi@gmail.com',
	name: 'Thandi',
	image: 'https://img/t.png',
}

// db.query answers in call order; records every call.
function fakeDb(...responses) {
	const query = jest.fn()
	for (const r of responses) query.mockResolvedValueOnce(r)
	return { query }
}

const sqlOf = (db) => db.query.mock.calls.map(([sql]) => sql)

describe('resolve_better_auth_user', () => {
	test('matches by Google account id (provider_id), never looking at email', async () => {
		const row = { user_id: 4, email: 'old@gmail.com' }
		const db = fakeDb([[row]])
		expect(await resolve_better_auth_user(db, googleUser)).toEqual({
			user: row,
		})
		expect(db.query).toHaveBeenCalledTimes(1)
		expect(db.query.mock.calls[0][1]).toEqual(['betterauth:ba_123'])
	})

	test('REFUSES an email that belongs to a username + PIN account (the hijack)', async () => {
		const db = fakeDb(
			[[]], // no provider match
			[[{ user_id: 9, has_pin: 1 }]] // PIN account with that email
		)
		expect(await resolve_better_auth_user(db, googleUser)).toEqual({
			conflict: PIN_ACCOUNT_CONFLICT,
		})
		expect(sqlOf(db).some((s) => /UPDATE|INSERT/.test(s))).toBe(
			false
		)
	})

	test('links an email match that has NO PIN to this Google account', async () => {
		const linked = { user_id: 1, email: 'thandi@gmail.com' }
		const db = fakeDb(
			[[]],
			[[{ user_id: 1, has_pin: 0 }]],
			[{ affectedRows: 1 }],
			[[linked]]
		)
		expect(await resolve_better_auth_user(db, googleUser)).toEqual({
			user: linked,
		})
		const [sql, params] = db.query.mock.calls[2]
		expect(sql).toMatch(/UPDATE users SET provider_id/)
		expect(params).toEqual(['betterauth:ba_123', 1])
	})

	test('creates a new user for a first-time Google sign-in', async () => {
		const created = { user_id: 12, email: 'thandi@gmail.com' }
		const db = fakeDb([[]], [[]], [{ insertId: 12 }], [[created]])
		expect(await resolve_better_auth_user(db, googleUser)).toEqual({
			user: created,
		})
		const [sql, params] = db.query.mock.calls[2]
		expect(sql).toMatch(/INSERT INTO users/)
		expect(params).toEqual([
			'betterauth:ba_123',
			'thandi@gmail.com',
			'Thandi',
			'https://img/t.png',
		])
	})
})
