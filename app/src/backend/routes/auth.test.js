import { jest } from '@jest/globals'
import crypto from 'crypto'
jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn() },
}))
const { default: pool } = await import('../utils/db.js')
const { default: authRouter, loginLimiter } = await import('./auth.js')
const { hashPin } = await import('../utils/pin_hash.js')
import express from 'express'
import { createServer } from 'http'

function hash(pin) {
	return crypto
		.createHash('sha256')
		.update(String(pin))
		.digest('hex')
		.toLowerCase()
}

function makeApp(session = {}) {
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = session
		next()
	})
	app.use('/api/auth', authRouter)
	return app
}
async function withServer(app, fn) {
	const server = createServer(app)
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const { port } = server.address()
	try {
		await fn(`http://127.0.0.1:${port}`)
	} finally {
		await new Promise((r) => server.close(r))
	}
}

describe('POST /api/auth/login', () => {
	beforeEach(() => {
		pool.query.mockReset()
		loginLimiter.reset()
	})
	test('400 when missing fields', async () => {
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
			expect(res.status).toBe(400)
		})
	})
	test('401 when user not found', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'a@a.com',
					pin: '1234',
				}),
			})
			expect(res.status).toBe(401)
		})
	})
	test('401 when pin wrong', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 1, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([[{ pin_hash: hash('9999') }]])
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'a@a.com',
					pin: '1234',
				}),
			})
			expect(res.status).toBe(401)
		})
	})
	test('200 login success', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 1, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([[{ pin_hash: hash('1234') }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // legacy hash upgrade
			.mockResolvedValueOnce([[{ role: 'SUPER_ADMIN' }]])
		const session = {}
		const app = makeApp(session)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'a@a.com',
					pin: '1234',
				}),
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.user.roles).toContain('SUPER_ADMIN')
		})
		expect(session.user).toBeDefined()
	})
	test('accepts password field as pin alias', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 1, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([[{ pin_hash: hash('1234') }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // legacy hash upgrade
			.mockResolvedValueOnce([[]])
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'a@a.com',
					password: '1234',
				}),
			})
			expect(res.status).toBe(200)
		})
	})

	function login(base, email, pin) {
		return fetch(`${base}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, pin }),
		})
	}

	test('legacy SHA-256 login upgrades the stored hash to salted scrypt', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 7, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([[{ pin_hash: hash('1234') }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[]])
		await withServer(makeApp({}), async (base) => {
			expect(
				(await login(base, 'a@a.com', '1234')).status
			).toBe(200)
		})
		const [sql, [newHash, userId]] = pool.query.mock.calls[2]
		expect(sql).toMatch(/UPDATE user_credentials SET pin_hash/)
		expect(newHash).toMatch(/^scrypt\$/)
		expect(userId).toBe(7)
	})

	test('scrypt hash: login works and nothing is re-written', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 1, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([
				[{ pin_hash: await hashPin('482913') }],
			])
			.mockResolvedValueOnce([[]]) // roles
		await withServer(makeApp({}), async (base) => {
			expect(
				(await login(base, 'a@a.com', '482913')).status
			).toBe(200)
		})
		expect(pool.query).toHaveBeenCalledTimes(3)
		expect(
			pool.query.mock.calls.some(([sql]) =>
				/UPDATE/.test(sql)
			)
		).toBe(false)
	})

	test('a failed hash upgrade does not block the login', async () => {
		pool.query
			.mockResolvedValueOnce([
				[{ user_id: 1, name: 'A', email: 'a@a.com' }],
			])
			.mockResolvedValueOnce([[{ pin_hash: hash('1234') }]])
			.mockRejectedValueOnce(new Error('Data too long'))
			.mockResolvedValueOnce([[]])
		const warn = jest
			.spyOn(console, 'warn')
			.mockImplementation(() => {})
		await withServer(makeApp({}), async (base) => {
			expect(
				(await login(base, 'a@a.com', '1234')).status
			).toBe(200)
		})
		warn.mockRestore()
	})

	test('429 with Retry-After after 5 wrong PINs; the right PIN is refused while locked', async () => {
		const wrong = () =>
			pool.query
				.mockResolvedValueOnce([
					[
						{
							user_id: 1,
							name: 'A',
							email: 'a@a.com',
						},
					],
				])
				.mockResolvedValueOnce([
					[{ pin_hash: hash('1234') }],
				])
		await withServer(makeApp({}), async (base) => {
			for (let i = 0; i < 5; i++) {
				wrong()
				expect(
					(await login(base, 'a@a.com', '0000'))
						.status
				).toBe(401)
			}
			const res = await login(base, 'a@a.com', '1234')
			expect(res.status).toBe(429)
			expect(
				Number(res.headers.get('retry-after'))
			).toBeGreaterThan(0)
		})
		// The locked request never reached the DB.
		expect(pool.query).toHaveBeenCalledTimes(10)
	})

	test('unknown usernames count toward the lockout too', async () => {
		await withServer(makeApp({}), async (base) => {
			for (let i = 0; i < 5; i++) {
				pool.query.mockResolvedValueOnce([[]])
				await login(base, 'ghost', '1234')
			}
			expect(
				(await login(base, 'ghost', '1234')).status
			).toBe(429)
		})
	})
})

describe('POST /api/auth/register', () => {
	beforeEach(() => pool.query.mockReset())
	test('400 when missing', async () => {
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'A' }),
			})
			expect(res.status).toBe(400)
		})
	})
	test('400 when email exists', async () => {
		pool.query.mockResolvedValueOnce([[{ user_id: 1 }]])
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'A',
					email: 'a@a.com',
					pin: '1234',
				}),
			})
			expect(res.status).toBe(400)
		})
	})
	test.each(['123', '1234567', 'abcd', '12 34'])(
		'400 when the PIN %p is not 4–6 digits',
		async (pin) => {
			await withServer(makeApp({}), async (base) => {
				const res = await fetch(
					`${base}/api/auth/register`,
					{
						method: 'POST',
						headers: {
							'Content-Type':
								'application/json',
						},
						body: JSON.stringify({
							name: 'Bob',
							email: 'bobby',
							pin,
						}),
					}
				)
				expect(res.status).toBe(400)
				expect((await res.json()).error).toMatch(
					/4 to 6 digits/
				)
			})
			expect(pool.query).not.toHaveBeenCalled()
		}
	)
	test('201 stores a salted scrypt hash, not the PIN or its SHA-256', async () => {
		pool.query
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([{ insertId: 9 }])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[]])
		await withServer(makeApp({}), async (base) => {
			const res = await fetch(`${base}/api/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'Bob',
					email: 'bobby',
					pin: '482913',
				}),
			})
			expect(res.status).toBe(201)
		})
		const [sql, [userId, stored]] = pool.query.mock.calls[2]
		expect(sql).toMatch(/INSERT INTO user_credentials/)
		expect(userId).toBe(9)
		expect(stored).toMatch(/^scrypt\$/)
		expect(stored).not.toContain('482913')
		expect(stored).not.toBe(hash('482913'))
	})
	test('201 creates user', async () => {
		pool.query
			.mockResolvedValueOnce([[]]) // existing
			.mockResolvedValueOnce([{ insertId: 2 }]) // insert users
			.mockResolvedValueOnce([{ affectedRows: 1 }]) // insert creds
			.mockResolvedValueOnce([[]]) // roles
		const session = {}
		const app = makeApp(session)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/register`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: 'Bob',
					email: 'bob@a.com',
					pin: '1234',
				}),
			})
			expect(res.status).toBe(201)
			expect(session.user.email).toBe('bob@a.com')
		})
	})
})

describe('GET /api/auth/me', () => {
	beforeEach(() => pool.query.mockReset())
	test('401 when no session', async () => {
		const app = makeApp({})
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/auth/me`)
			expect(res.status).toBe(401)
		})
	})
	test('200 returns user with roles', async () => {
		pool.query.mockResolvedValueOnce([[{ role: 'EVENT_AUTHOR' }]])
		const app = makeApp({
			user: { user_id: 1, name: 'A', email: 'a@a.com' },
		})
		// need session.user for me route: it reads req.session.user
		const sess = {
			user: { user_id: 1, name: 'A', email: 'a@a.com' },
		}
		const app2 = express()
		app2.use(express.json())
		app2.use((req, _res, next) => {
			req.session = sess
			next()
		})
		app2.use('/api/auth', authRouter)
		const server = createServer(app2)
		await new Promise((r) => server.listen(0, '127.0.0.1', r))
		const { port } = server.address()
		const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.roles).toContain('EVENT_AUTHOR')
		await new Promise((r) => server.close(r))
	})
})

describe('POST /api/auth/logout', () => {
	test('200 logout', async () => {
		const sess = { destroy: (cb) => cb() }
		const app = express()
		app.use(express.json())
		app.use((req, _res, next) => {
			req.session = sess
			next()
		})
		app.use('/api/auth', authRouter)
		const server = createServer(app)
		await new Promise((r) => server.listen(0, '127.0.0.1', r))
		const { port } = server.address()
		const res = await fetch(
			`http://127.0.0.1:${port}/api/auth/logout`,
			{ method: 'POST' }
		)
		expect(res.status).toBe(200)
		await new Promise((r) => server.close(r))
	})
})
