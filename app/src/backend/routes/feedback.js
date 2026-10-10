import express from 'express'
import pool from '../utils/db.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Feedback Router] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

const CATEGORIES = ['BUG', 'ACCOUNT', 'LOCATION', 'CONTENT', 'OTHER']
const STATUSES = ['NEW', 'ACKNOWLEDGED', 'RESOLVED']
const ADMIN_ROLES = ['SUPER_ADMIN', 'EVENT_AUTHOR', 'CARD_AUTHOR', 'MODERATOR']

function requireAuth(req, res, next) {
	const userId = req.session?.user?.user_id || req.user?.user_id
	if (!userId)
		return res
			.status(401)
			.json({ error: 'Unauthorised — please log in' })
	if (!req.user) req.user = req.session.user
	next()
}

async function requireAdmin(req, res, next) {
	const placeholders = ADMIN_ROLES.map(() => '?').join(', ')
	const userId = req.session?.user?.user_id || req.user?.user_id
	try {
		const [rows] = await pool.query(
			`SELECT 1 FROM admin_roles WHERE user_id = ? AND role IN (${placeholders}) LIMIT 1`,
			[userId, ...ADMIN_ROLES]
		)
		if (!rows.length)
			return res.status(403).json({
				error: 'Forbidden — admin role required',
			})
		next()
	} catch (err) {
		return res.status(500).json({ error: err.message })
	}
}

function rowToReport(row) {
	return {
		report_id: row.report_id,
		user_id: row.user_id,
		name: row.name,
		email: row.email,
		category: row.category,
		title: row.title,
		body: row.body,
		status: row.status,
		admin_note: row.admin_note,
		created_at: row.created_at,
		updated_at: row.updated_at,
	}
}

// POST /api/feedback — file a report (logged-in players)
router.post('/', requireAuth, async (req, res) => {
	try {
		const userId = req.user.user_id
		const category = String(
			req.body?.category || 'OTHER'
		).toUpperCase()
		const title = String(req.body?.title || '').trim()
		const body = String(req.body?.body || '').trim()
		if (!CATEGORIES.includes(category))
			return res.status(400).json({
				error: `category must be one of: ${CATEGORIES.join(', ')}`,
			})
		if (!title || title.length > 200)
			return res.status(400).json({
				error: 'title is required (max 200 characters)',
			})
		if (!body || body.length > 5000)
			return res.status(400).json({
				error: 'description is required (max 5000 characters)',
			})
		const [result] = await pool.query(
			`INSERT INTO feedback_reports (user_id, category, title, body)
			 VALUES (?, ?, ?, ?)`,
			[userId, category, title, body]
		)
		const [rows] = await pool.query(
			`SELECT r.*, u.name, u.email FROM feedback_reports r
			 LEFT JOIN users u ON u.user_id = r.user_id
			 WHERE r.report_id = ?`,
			[result.insertId]
		)
		res.status(201).json(rowToReport(rows[0]))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// GET /api/feedback/mine — my reports (logged-in players)
router.get('/mine', requireAuth, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT r.*, u.name, u.email FROM feedback_reports r
			 LEFT JOIN users u ON u.user_id = r.user_id
			 WHERE r.user_id = ? ORDER BY r.created_at DESC`,
			[req.user.user_id]
		)
		res.json(rows.map(rowToReport))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// GET /api/feedback — all reports (admins), optional ?status=
router.get('/', requireAuth, requireAdmin, async (req, res) => {
	try {
		const status = String(req.query.status || 'ALL').toUpperCase()
		if (status !== 'ALL' && !STATUSES.includes(status))
			return res.status(400).json({
				error: `status must be one of: ALL, ${STATUSES.join(', ')}`,
			})
		const [rows] =
			status === 'ALL'
				? await pool.query(
						`SELECT r.*, u.name, u.email FROM feedback_reports r
						 LEFT JOIN users u ON u.user_id = r.user_id
						 ORDER BY r.created_at DESC`
					)
				: await pool.query(
						`SELECT r.*, u.name, u.email FROM feedback_reports r
						 LEFT JOIN users u ON u.user_id = r.user_id
						 WHERE r.status = ? ORDER BY r.created_at DESC`,
						[status]
					)
		res.json(rows.map(rowToReport))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// PATCH /api/feedback/:id — triage a report (admins)
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
	try {
		const reportId = parseInt(req.params.id, 10)
		if (!Number.isInteger(reportId))
			return res
				.status(400)
				.json({ error: 'invalid report id' })
		const updates = {}
		if (req.body?.status !== undefined) {
			const status = String(req.body.status).toUpperCase()
			if (!STATUSES.includes(status))
				return res.status(400).json({
					error: `status must be one of: ${STATUSES.join(', ')}`,
				})
			updates.status = status
		}
		if (req.body?.admin_note !== undefined) {
			const note = String(req.body.admin_note || '').trim()
			if (note.length > 2000)
				return res.status(400).json({
					error: 'admin_note is too long (max 2000 characters)',
				})
			updates.admin_note = note || null
		}
		if (!Object.keys(updates).length)
			return res.status(400).json({
				error: 'nothing to update — send status and/or admin_note',
			})
		const sets = Object.keys(updates)
			.map((k) => `${k} = ?`)
			.join(', ')
		const [result] = await pool.query(
			`UPDATE feedback_reports SET ${sets} WHERE report_id = ?`,
			[...Object.values(updates), reportId]
		)
		if (!result.affectedRows)
			return res
				.status(404)
				.json({ error: 'report not found' })
		const [rows] = await pool.query(
			`SELECT r.*, u.name, u.email FROM feedback_reports r
			 LEFT JOIN users u ON u.user_id = r.user_id
			 WHERE r.report_id = ?`,
			[reportId]
		)
		res.json(rowToReport(rows[0]))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
