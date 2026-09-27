import express from 'express'
import pool from '../utils/db.js'
import { hashPin, verifyPin, isValidPin } from '../utils/pin_hash.js'
import { createLoginLimiter } from '../utils/login_limiter.js'

const router = express.Router()

// Failed username + PIN logins, per ip+username and per ip.
export const loginLimiter = createLoginLimiter()

router.use((req, res, next) => {
	console.log(
		`[Auth Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

// LOGIN ROUTE
router.post('/login', async (req, res) => {
	const { email, pin, password } = req.body
	const inputPin = pin || password // accepts pin or password field from frontend
	const userEmail = email ? email.trim().toLowerCase() : ''

	if (!userEmail || !inputPin) {
		return res
			.status(400)
			.json({ error: 'email and pin are required' })
	}

	const ip = req.ip
	const waitMs = loginLimiter.retryAfterMs(ip, userEmail)
	if (waitMs > 0) {
		res.set('Retry-After', String(Math.ceil(waitMs / 1000)))
		return res.status(429).json({
			error: `Too many failed attempts. Try again in ${Math.ceil(waitMs / 60000)} minute(s).`,
		})
	}

	try {
		const [users] = await pool.query(
			'SELECT user_id, name, email FROM users WHERE LOWER(email) = ?',
			[userEmail]
		)

		if (!users.length) {
			loginLimiter.recordFailure(ip, userEmail)
			return res
				.status(401)
				.json({ error: 'Invalid credentials' })
		}

		const user = users[0]

		const [creds] = await pool.query(
			'SELECT pin_hash FROM user_credentials WHERE user_id = ?',
			[user.user_id]
		)

		const { ok, needsRehash } = await verifyPin(
			inputPin,
			creds[0]?.pin_hash
		)
		if (!ok) {
			loginLimiter.recordFailure(ip, userEmail)
			return res
				.status(401)
				.json({ error: 'Invalid credentials' })
		}
		loginLimiter.recordSuccess(ip, userEmail)

		// Upgrade a legacy unsalted SHA-256 hash to scrypt now that we
		// have the plain PIN. A failure here must not block the login.
		if (needsRehash) {
			try {
				await pool.query(
					'UPDATE user_credentials SET pin_hash = ? WHERE user_id = ?',
					[await hashPin(inputPin), user.user_id]
				)
			} catch (err) {
				console.warn(
					'[auth] PIN hash upgrade failed:',
					err.message
				)
			}
		}

		// Store session
		req.session.user = {
			user_id: user.user_id,
			name: user.name,
			username: user.name,
			email: user.email,
		}

		const [roleRows] = await pool.query(
			'SELECT role FROM admin_roles WHERE user_id = ?',
			[user.user_id]
		)

		res.json({
			message: 'Logged in',
			user: {
				...req.session.user,
				roles: roleRows.map((r) => r.role),
			},
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// REGISTER ROUTE
router.post('/register', async (req, res) => {
	const { name, email, password, pin } = req.body
	const inputPin = pin || password
	const userEmail = email ? email.trim().toLowerCase() : ''

	if (!name || !userEmail || !inputPin) {
		return res.status(400).json({
			error: 'name, email, and password/pin are required',
		})
	}
	if (!isValidPin(String(inputPin))) {
		return res
			.status(400)
			.json({ error: 'PIN must be 4 to 6 digits' })
	}

	try {
		const [existing] = await pool.query(
			'SELECT user_id FROM users WHERE LOWER(email) = ?',
			[userEmail]
		)

		if (existing.length > 0) {
			return res
				.status(400)
				.json({ error: 'Email already registered' })
		}

		const provider_id = `local:${userEmail}`
		const [result] = await pool.query(
			'INSERT INTO users (provider_id, email, name, points) VALUES (?, ?, ?, 0)',
			[provider_id, userEmail, name.trim()]
		)

		const userId = result.insertId
		const hashedPin = await hashPin(String(inputPin))

		await pool.query(
			'INSERT INTO user_credentials (user_id, pin_hash) VALUES (?, ?)',
			[userId, hashedPin]
		)

		req.session.user = {
			user_id: userId,
			name: name.trim(),
			username: name.trim(),
			email: userEmail,
		}

		const [roleRows] = await pool.query(
			'SELECT role FROM admin_roles WHERE user_id = ?',
			[userId]
		)

		res.status(201).json({
			message: 'Account created successfully',
			user: {
				...req.session.user,
				roles: roleRows.map((r) => r.role),
			},
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// SESSION CHECK ROUTE
router.get('/me', async (req, res) => {
	if (!req.session?.user?.user_id) {
		return res.status(401).json({ error: 'Not authenticated' })
	}

	const { user_id, name, email } = req.session.user

	try {
		const [rows] = await pool.query(
			'SELECT role FROM admin_roles WHERE user_id = ?',
			[user_id]
		)

		res.json({
			user_id,
			name,
			email,
			roles: rows.map((r) => r.role),
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// LOGOUT ROUTE
router.post('/logout', (req, res) => {
	req.session.destroy(() => {
		res.clearCookie('a2a-session-key')
		res.json({ message: 'Logged out' })
	})
})

export default router
