import express from 'express'

import { error, success } from '../utils/response.js'
import { list_live_battles } from '../websocket/spectate_socket.js'

const router = express.Router()

router.use((req, res, next) => {
	console.log(
		`[Battles Router Log] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
	)
	next()
})

function requireAuth(req, res, next) {
	if (!req.user?.user_id) {
		return error(res, 401, 'Unauthorised — please log in')
	}
	next()
}

// Live battles that can be spectated: everything currently held in
// memory in battle_states (both decks submitted, not yet finished).
router.get('/live', requireAuth, async (req, res) => {
	try {
		const battles = await list_live_battles()
		return success(res, { battles })
	} catch (err) {
		console.error('live battles error:', err)
		return error(res, 500, 'Could not load live battles')
	}
})

export default router
