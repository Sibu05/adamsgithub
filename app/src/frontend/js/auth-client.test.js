import { jest } from '@jest/globals'
import { API_BASE } from './constants.js'
import { googleSignIn, usernameSignIn } from './auth-client.js'

function mockFetch(status, body) {
	global.fetch = jest.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}))
}

afterEach(() => {
	delete global.fetch
	jest.restoreAllMocks()
})

describe('googleSignIn', () => {
	// main.js does `const { error } = await googleSignIn()`, so it must
	// always resolve to an object — it used to resolve to undefined and
	// throw a TypeError.
	beforeEach(() =>
		jest.spyOn(console, 'error').mockImplementation(() => {})
	)

	test('returns { data: null, error } when the server rejects', async () => {
		mockFetch(500, { message: 'Table user does not exist' })
		const result = await googleSignIn()
		expect(result.data).toBeNull()
		expect(result.error.message).toBe('Table user does not exist')
	})

	test('returns an error when no authorization URL comes back', async () => {
		mockFetch(200, {})
		const { error } = await googleSignIn()
		expect(error.message).toMatch(/authorization URL/)
	})

	test('returns { error } instead of throwing on a network failure', async () => {
		global.fetch = jest.fn(async () => {
			throw new Error('offline')
		})
		const { data, error } = await googleSignIn()
		expect(data).toBeNull()
		expect(error.message).toBe('offline')
	})

	test('posts to Better Auth social sign-in with the google provider', async () => {
		mockFetch(500, {})
		await googleSignIn()
		const [url, init] = global.fetch.mock.calls[0]
		expect(url).toBe(`${API_BASE}/api/auth/sign-in/social`)
		expect(JSON.parse(init.body).provider).toBe('google')
		expect(init.credentials).toBe('include')
	})
})

describe('usernameSignIn', () => {
	test('returns the user on success', async () => {
		mockFetch(200, { user: { user_id: 1 } })
		const { data, error } = await usernameSignIn('thandi', '1234')
		expect(error).toBeNull()
		expect(data).toEqual({ user_id: 1 })
	})

	test('returns the server error message on failure', async () => {
		mockFetch(401, { error: 'Invalid credentials' })
		const { data, error } = await usernameSignIn('thandi', '0000')
		expect(data).toBeNull()
		expect(error.message).toBe('Invalid credentials')
	})
})
