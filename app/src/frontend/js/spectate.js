import { API_BASE, API_BASE_WS } from './constants.js'
import { updateAuthNav } from './auth-helpers.js'
import { startChromeDayNightCycle } from './campus-style.js'
import { DEMO_BATTLE_ID, startDemoStream } from './spectate-demo.js'

// Read-only view of a live battle. Real matches come over /ws/spectate,
// the demo comes from spectate-demo.js; both feed handleMessage() with the
// same message shapes, so there is a single render path.

startChromeDayNightCycle()

const LOG_LIMIT = 6

const el = (id) => document.getElementById(id)

let ws = null
let pingInterval = null
let stopDemo = null
let watching = null // { battle_id, players, state, log, ended }

// ── Helpers ─────────────────────────────────────────────────

function showError(msg) {
	const box = el('list-error')
	if (!box) return
	box.textContent = msg
	box.classList.toggle('hidden', !msg)
}

function fallbackPlayers(state) {
	return {
		player1: { user_id: state.player1_id, name: 'Player 1' },
		player2: {
			user_id: state.player2_id,
			name: state.player2_id === null ? 'CPU' : 'Player 2',
		},
	}
}

function nameFor(user_id) {
	const { player1, player2 } = watching.players
	if (user_id === player1.user_id) return player1.name
	if (user_id === player2.user_id) return player2.name
	return null
}

function sideCards(state, side) {
	return side === 1 ? state.cards.player1 : state.cards.player2
}

const TEAM_ACTIONS = ['BUFF', 'REVIVE', 'DEFEND', 'DODGE']

// One human-readable log line for a player_result / opponent_result.
export function describeMove(state, players, side, result) {
	const actor = side === 1 ? players.player1 : players.player2
	const own = sideCards(state, side)
	const other = sideCards(state, side === 1 ? 2 : 1)
	const attacker = own.find(
		(c) => c.slot_position === result.attacker_slot
	)
	const target_pool = TEAM_ACTIONS.includes(result.action) ? own : other
	const target = target_pool.find(
		(c) => c.slot_position === result.target_slot
	)
	const who = `${actor.name}'s ${attacker?.name ?? 'card'}`
	if (result.action === 'ATTACK') {
		return result.landed
			? `${who} hit ${target?.name ?? 'a card'} for ${result.damage}`
			: `${who} missed ${target?.name ?? 'a card'}`
	}
	return `${who} used ${result.action}`
}

// ── List view ───────────────────────────────────────────────

export function renderLiveList(battles) {
	const list = el('live-list')
	const empty = el('live-empty')
	list.replaceChildren()
	empty.classList.toggle('hidden', battles.length > 0)

	for (const b of battles) {
		const li = document.createElement('li')
		li.className = 'live-item'

		const title = document.createElement('div')
		title.className = 'live-item-title'
		title.textContent = `${b.player1.name} vs ${b.player2.name}`

		const meta = document.createElement('div')
		meta.className = 'live-item-meta'
		meta.textContent = `Turn ${Math.floor(b.turn_number)} · ${b.current_turn.name} to move`

		const btn = document.createElement('button')
		btn.className = 'btn btn-primary btn-sm'
		btn.textContent = 'Watch'
		btn.addEventListener('click', () => watchLive(b.battle_id))

		const text = document.createElement('div')
		text.append(title, meta)
		li.append(text, btn)
		list.appendChild(li)
	}
}

export async function loadLiveBattles() {
	el('live-loading').classList.remove('hidden')
	try {
		const res = await fetch(`${API_BASE}/api/battles/live`, {
			credentials: 'include',
		})
		if (!res.ok) throw new Error(`server responded ${res.status}`)
		const { battles } = await res.json()
		renderLiveList(battles)
		showError('')
	} catch (err) {
		renderLiveList([])
		showError(`Could not load live matches — ${err.message}`)
	} finally {
		el('live-loading').classList.add('hidden')
	}
}

function showListView() {
	el('view-watch').classList.add('hidden')
	el('view-list').classList.remove('hidden')
}

function showWatchView() {
	el('view-list').classList.add('hidden')
	el('view-watch').classList.remove('hidden')
}

// ── Watch view ──────────────────────────────────────────────

function renderCard(card) {
	const li = document.createElement('li')
	li.className = 'battle-card spectate-card'
	li.dataset.slot = card.slot_position
	li.dataset.rarity = String(card.rarity || '').toUpperCase()
	if (card.health <= 0) li.classList.add('dead')

	const bar = document.createElement('div')
	bar.className = 'battle-card-health-bar'
	const fill = document.createElement('div')
	fill.className = 'battle-card-health-fill'
	const max = card.stat_legacy || 1
	fill.style.width = `${Math.max(0, Math.round((card.health * 100) / max))}%`
	bar.appendChild(fill)

	const tag = document.createElement('span')
	tag.className = 'battle-card-category-tag'
	tag.dataset.category = card.category
	tag.textContent = card.category

	const name = document.createElement('p')
	name.className = 'battle-card-name'
	name.textContent = card.name

	const hp = document.createElement('p')
	hp.className = 'spectate-card-hp'
	hp.textContent = `${card.health} / ${max} HP`

	li.append(bar, tag, name, hp)
	return li
}

export function renderWatch() {
	if (!watching?.state) return
	const { state, players } = watching

	el('watch-title').textContent =
		`${players.player1.name} vs ${players.player2.name}`
	el('p1-name').textContent = players.player1.name
	el('p2-name').textContent = players.player2.name
	el('watch-demo-tag').classList.toggle(
		'hidden',
		watching.battle_id !== DEMO_BATTLE_ID
	)

	el('p1-cards').replaceChildren(...state.cards.player1.map(renderCard))
	el('p2-cards').replaceChildren(...state.cards.player2.map(renderCard))

	const turn_side = state.turn === state.player1_id ? 1 : 2
	el('p1-board').classList.toggle('is-turn', turn_side === 1)
	el('p2-board').classList.toggle('is-turn', turn_side === 2)
	el('watch-turn').textContent = watching.ended
		? 'Match over'
		: `${nameFor(state.turn) ?? players.player2.name}'s turn`
	el('watch-turn-number').textContent =
		`Turn ${Math.floor(state.turn_number)}`

	const log = el('watch-log')
	log.replaceChildren(
		...watching.log.map((line) => {
			const li = document.createElement('li')
			li.textContent = line
			return li
		})
	)
}

function pushLog(line) {
	watching.log.unshift(line)
	watching.log.length = Math.min(watching.log.length, LOG_LIMIT)
}

function showWinner(winner) {
	watching.ended = true
	const { player1, player2 } = watching.players || {
		player1: {},
		player2: {},
	}
	let text
	if (winner === player1.user_id) text = `🏆 ${player1.name} wins!`
	else if (winner === player2.user_id) text = `🏆 ${player2.name} wins!`
	else text = 'Match ended with no winner'
	el('watch-result-text').textContent = text
	el('watch-result').classList.remove('hidden')
	renderWatch()
}

export function handleMessage(msg) {
	if (!watching) return
	switch (msg.type) {
		case 'state_update':
			watching.state = msg.state
			watching.players =
				msg.players ||
				watching.players ||
				fallbackPlayers(msg.state)
			renderWatch()
			break
		case 'turn_result': {
			if (!msg.state?.cards) break
			watching.state = msg.state
			watching.players ||= fallbackPlayers(msg.state)
			const p_side =
				msg.player_user_id === msg.state.player1_id
					? 1
					: 2
			if (msg.player_result)
				pushLog(
					describeMove(
						msg.state,
						watching.players,
						p_side,
						msg.player_result
					)
				)
			if (msg.opponent_result)
				pushLog(
					describeMove(
						msg.state,
						watching.players,
						p_side === 1 ? 2 : 1,
						msg.opponent_result
					)
				)
			renderWatch()
			break
		}
		case 'match_results':
			showWinner(msg.winner)
			closeSocket()
			break
		case 'no_battle':
			stopWatching()
			showError('That match has already finished.')
			break
		case 'error':
			showError(msg.message)
			break
	}
}

function beginWatching(battle_id) {
	stopWatching({ refresh: false })
	watching = {
		battle_id,
		players: null,
		state: null,
		log: [],
		ended: false,
	}
	el('watch-result').classList.add('hidden')
	el('watch-log').replaceChildren()
	el('p1-cards').replaceChildren()
	el('p2-cards').replaceChildren()
	el('watch-title').textContent = 'Connecting…'
	el('watch-turn').textContent = ''
	showError('')
	showWatchView()
}

export function watchLive(battle_id) {
	beginWatching(battle_id)
	const socket = new WebSocket(`${API_BASE_WS}/ws/spectate`)
	ws = socket
	socket.onopen = () => {
		socket.send(JSON.stringify({ type: 'watch', battle_id }))
		pingInterval = setInterval(
			() => socket.send(JSON.stringify({ type: 'ping' })),
			25000
		)
	}
	socket.onmessage = (event) => {
		try {
			handleMessage(JSON.parse(event.data))
		} catch (err) {
			console.error('Bad spectate message:', err)
		}
	}
	socket.onclose = () => {
		clearInterval(pingInterval)
		if (ws === socket && watching && !watching.ended)
			showError('Lost connection to the match.')
	}
}

export function watchDemo(intervalMs) {
	beginWatching(DEMO_BATTLE_ID)
	stopDemo = startDemoStream(handleMessage, intervalMs)
}

function closeSocket() {
	clearInterval(pingInterval)
	pingInterval = null
	if (ws) {
		const socket = ws
		ws = null
		if (socket.readyState === 1)
			socket.send(JSON.stringify({ type: 'leave' }))
		socket.close()
	}
}

export function stopWatching({ refresh = true } = {}) {
	if (stopDemo) stopDemo()
	stopDemo = null
	closeSocket()
	watching = null
	showListView()
	if (refresh) loadLiveBattles()
}

// ── Boot ────────────────────────────────────────────────────

export async function checkAccess() {
	let res
	try {
		res = await fetch(`${API_BASE}/api/me`, {
			credentials: 'include',
		})
	} catch {
		showError(
			'Could not reach the server — check your connection, then refresh.'
		)
		return
	}
	if (res.status === 401) {
		window.location.href = '../index.html'
		return
	}
	if (!res.ok) {
		showError(
			`Could not verify your session (server responded with ${res.status}).`
		)
		return
	}
	updateAuthNav(await res.json())

	el('btn-demo').addEventListener('click', () => watchDemo())
	el('btn-refresh').addEventListener('click', () => loadLiveBattles())
	el('btn-stop').addEventListener('click', () => stopWatching())
	await loadLiveBattles()
}

export const ready = checkAccess()
