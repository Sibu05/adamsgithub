/**
 * Adamas2Aurum — Express Server (dev branch)
 *
 * Integrates Better Auth (from feat/user-story-1-auth) with the existing
 * team infrastructure. A bridge middleware maps Better Auth sessions to
 * express-session so that existing routes (events, trivia) keep working
 * without modification.
 *
 * All existing functionality preserved:
 *   - event_routes, trivia_routes, auth_routes (PIN-based, kept for compat)
 *   - initialize_database (schema.sql with CREATE TABLE IF NOT EXISTS)
 *   - seed_database (only when SEED_DB=true)
 *   - /api/health endpoint
 */

import express from 'express'
import session from 'express-session'
import mySQLSession from 'express-mysql-session'
import cors from 'cors'
import { createServer } from 'http'

import path from 'path'
import { fileURLToPath } from 'url'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'

import event_routes from './routes/events.js'
import card_routes from './routes/cards.js'
import auth_routes from './routes/auth.js'
import trivia_routes from './routes/trivia.js'
import question_routes from './routes/questions.js'
import pool_routes from './routes/event_pool.js'
import leaderboard_routes from './routes/leaderboard.js'
import sync_routes from './routes/sync.js'
import campaign_routes from './routes/campaigns.js'
import analytics_routes from './routes/analytics.js'

import pool from './utils/db.js'
import { auth } from './src/auth.js'
import { execute_sql_script } from './utils/sql_utils.js'
import { setup_websocket_router } from './websocket/socket_router.js'

import qr_routes from './routes/qr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
const allowed_origins = [
	'http://localhost:8055',
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	'https://website.adamas2aurum.workers.dev',
]
if (process.env.FRONTEND_URL) allowed_origins.push(process.env.FRONTEND_URL)

app.use(
	cors({
		origin: (origin, callback) => {
			if (!origin || allowed_origins.includes(origin)) {
				callback(null, true)
			} else {
				callback(new Error('Not allowed by CORS'))
			}
		},
		credentials: true,
	})
)

const MySQLStore = mySQLSession(session)
const sessionStore = new MySQLStore(
	{
		clearExpired: true,
		checkExpirationInterval: 900000, // 15 mins
		expiration: 86400000, // 24 hrs
	},
	pool
)

const session_middleware = session({
	key: 'a2a-session-key',
	secret: process.env.SESSION_SECRET || 'a2a-dev-secret',
	store: sessionStore,
	resave: false,
	saveUninitialized: false,
	cookie: {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: process.env.NODE_ENV === 'production' ? 'none': 'lax',
		maxAge: 1000 * 60 * 60 * 24, // 24 hours
	},
})
app.use(session_middleware)
app.use((req, res, next) => {
	req.user = req.session?.user || null
	next()
})

const PIN_AUTH_PATHS = ['/login', '/register', '/logout', '/me']

app.use('/api/auth', (req, res, next) => {
	if (PIN_AUTH_PATHS.includes(req.path)) {
		return next() // skip Better Auth → falls through to auth_routes below
	}
	toNodeHandler(auth)(req, res, next)
})

app.use('/api/auth', auth_routes)

// ── SESSION RESOLUTION MIDDLEWARE ──
// Populates req.user from EITHER our custom session OR Better Auth's session.
app.use(async (req, res, next) => {
	// 1. Custom session (username + PIN)
	if (req.session?.user?.user_id) {
		try {
			const [users] = await pool.query(
				'SELECT user_id, name, email, avatar_url, points FROM users WHERE user_id = ?',
				[req.session.user.user_id]
			)
			if (users.length) req.user = users[0]
		} catch (err) {
			console.warn(
				'Custom session resolve error:',
				err.message
			)
		}
		return next()
	}

	// 2. Better Auth session (Google OAuth)
	try {
		const bSession = await auth.api.getSession({
			headers: fromNodeHeaders(req.headers),
		})
		if (bSession?.user) {
			const [users] = await pool.query(
				'SELECT user_id, name, email, avatar_url, points FROM users WHERE email = ?',
				[bSession.user.email]
			)
			if (users.length) {
				req.user = users[0]
			} else {
				// First-time Google user — sync into our users table
				const [result] = await pool.query(
					`INSERT INTO users (provider_id, email, name, avatar_url, points)
           VALUES (?, ?, ?, ?, 0)`,
					[
						`betterauth:${bSession.user.id}`,
						bSession.user.email,
						bSession.user.name,
						bSession.user.image,
					]
				)
				const [newUsers] = await pool.query(
					'SELECT user_id, name, email, avatar_url, points FROM users WHERE user_id = ?',
					[result.insertId]
				)
				req.user = newUsers[0]
			}
			// Keep the express-session cookie in sync so existing code that reads
			// req.session.user.user_id continues to work for Google-OAuth users.
			req.session.user = req.user
		}
	} catch (err) {
		// Silently continue for unauthenticated requests
	}
	next()
})

app.use('/api/events', qr_routes)
app.use('/api/events', pool_routes)
app.use('/api/events', event_routes)
app.use('/api/cards', card_routes)
app.use('/api/trivia', trivia_routes)
// User Story 6 — question authoring. Mounted at /api so the single
// router can serve both /api/events/:eventId/questions and /api/questions/:id.
app.use('/api', question_routes)

// User Story 7 — global points leaderboard. Public read; the "/me"
// sub-route is the only part that requires a session.
app.use('/api/leaderboard', leaderboard_routes)

// User Story 2 (Sprint 2) — offline attempt sync and deferred verification.
// Mounted under /api/trivia so all trivia-related endpoints share a namespace.
app.use('/api/trivia', sync_routes)

app.use('/api/campaigns', campaign_routes)
app.use('/api/analytics', analytics_routes)

app.get('/api/health', async (req, res) => {
	try {
		const [rows] = await pool.query('SHOW TABLES')
		res.json({ success: true, tables: rows })
	} catch (error) {
		res.status(500).json({ success: false, error: error.message })
	}
})

// ---------------------------------------------------------------------------
// Get current authenticated user (used by frontend checkAuthSession)
// ---------------------------------------------------------------------------
app.get('/api/me', async (req, res) => {
	if (!req.user?.user_id) {
		return res.status(401).json({ error: 'Not authenticated' })
	}
	res.json(req.user)
})

// ---------------------------------------------------------------------------
// Static file serving — backend serves the frontend so everything runs
// from the same origin (port 3000), eliminating cross-origin cookie issues.
// ---------------------------------------------------------------------------
const frontendDir = path.join(__dirname, '..', 'frontend')
const pagesDir = path.join(frontendDir, 'pages')

app.use('/css', express.static(path.join(frontendDir, 'css')))
app.use('/js', express.static(path.join(frontendDir, 'js')))
app.use(express.static(path.join(frontendDir, 'public')))

// Main map page
app.get('/index.html', (_req, res) => {
	res.sendFile(path.join(frontendDir, 'index.html'))
})

app.get('/', (_req, res) => {
	res.sendFile(path.join(frontendDir, 'index.html'))
})

// Other HTML pages
app.get('/pages/auth.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'auth.html'))
})
app.get('/pages/collection.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'collection.html'))
})
app.get('/pages/console.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'console.html'))
})
app.get('/pages/events.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'events.html'))
})
app.get('/pages/battle.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'battle.html'))
})
app.get('/pages/leaderboard.html', (_req, res) => {
	res.sendFile(path.join(pagesDir, 'leaderboard.html'))
})

// ---------------------------------------------------------------------------
// Database initialization (unchanged from dev)
// ---------------------------------------------------------------------------
async function ensure_curation_schema() {
	// Campaigns table already in schema.sql with IF NOT EXISTS; these
	// ALTERs are guarded so re-running never errors (1060 = duplicate column).
	const alters = [
		`ALTER TABLE events ADD COLUMN curation_status ENUM('DRAFT','IN_REVIEW','PUBLISHED','RETIRED','ARCHIVED') NOT NULL DEFAULT 'DRAFT'`,
		`ALTER TABLE events ADD COLUMN campaign_id INT NULL`,
		`ALTER TABLE events ADD COLUMN retired_at DATETIME NULL`,
		`ALTER TABLE events ADD COLUMN published_at DATETIME NULL`,
	]
	for (const sql of alters) {
		try {
			await pool.query(sql)
		} catch (err) {
			if (
				err.code !== 'ER_DUP_FIELDNAME' &&
				err.errno !== 1060
			)
				console.warn(
					'[curation migration]',
					err.message
				)
		}
	}
	// FK for campaign_id (may already exist)
	try {
		await pool.query(
			`ALTER TABLE events ADD CONSTRAINT fk_event_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE SET NULL`
		)
	} catch (err) {
		if (
			err.code !== 'ER_DUP_KEY' &&
			err.errno !== 1022 &&
			!String(err.message).includes('Duplicate')
		) {
			// ignore duplicate FK
		}
	}
	// Backfill: existing active events become PUBLISHED so they stay visible
	try {
		await pool.query(
			`UPDATE events SET curation_status = 'PUBLISHED' WHERE curation_status = 'DRAFT' AND is_active = TRUE`
		)
	} catch {}
}

async function initialize_database() {
	// Creates tables if they don't exist yet — safe to run every startup,
	// since schema.sql uses CREATE TABLE IF NOT EXISTS and doesn't touch data.
	await execute_sql_script(pool, './db/schema.sql')
	await ensure_curation_schema()
}

async function seed_database() {
	// Destructive: TRUNCATEs and re-inserts all seed data. This must NOT run
	// automatically on every `npm run dev`, since the DB is shared across the
	// whole team — one teammate starting their backend would silently wipe
	// out data another teammate is actively testing against (this is what
	// caused login to intermittently fail with "Invalid credentials" even
	// though the seeded PIN was correct).
	//
	// Run explicitly instead: `npm run db:seed`
	await execute_sql_script(pool, './db/seed.sql')
}

async function clear_database() {
	await execute_sql_script(pool, './db/clear_db.sql')
}

async function view_database() {
	console.log(await pool.query('SELECT NOW() as currentTime;'))
	console.log(await pool.query('SHOW DATABASES;'))
	console.log(
		await pool.query(
			`SHOW TABLES FROM ${process.env.DB_NAME || 'testdb'};`
		)
	)
	// console.log(await pool.query('DESCRIBE ${process.env.DB_NAME || 'testdb'}.battle_turns;'))
}

try {
	await initialize_database()

	if (process.env.CLEAR_DB === 'true') {
		await clear_database()
	}
	if (process.env.SEED_DB === 'true') {
		await seed_database()
	}
	if (process.env.LOG_DB === 'true') {
		await view_database()
	}
} catch (err) {
	console.error('error: ', err.message)
}

const server = createServer(app)
setup_websocket_router(server, session_middleware)

server.listen(PORT, () => {
	console.log(`A2A backend running on port ${PORT}`)
	console.log(`Open: http://localhost:${PORT}`)
})
