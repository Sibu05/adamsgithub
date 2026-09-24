import { jest } from '@jest/globals'
import { readFileSync } from 'fs'
import { API_BASE, API_BASE_WS } from './constants.js'

// Load the real page markup so the tests break if ids drift.
const html = readFileSync(
	new URL('../pages/spectate.html', import.meta.url),
	'utf8'
)
document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1]

let liveBattles = []
global.fetch = jest.fn(async (url) => {
	if (url === `${API_BASE}/api/me`)
		return {
			ok: true,
			status: 200,
			json: async () => ({ user_id: 1 }),
		}
	if (url === `${API_BASE}/api/battles/live`)
		return {
			ok: true,
			status: 200,
			json: async () => ({ battles: liveBattles }),
		}
	throw new Error(`unexpected fetch ${url}`)
})

class FakeWebSocket {
	static instances = []
	constructor(url) {
		this.url = url
		this.readyState = 1
		this.sent = []
		FakeWebSocket.instances.push(this)
	}
	send(data) {
		this.sent.push(JSON.parse(data))
	}
	close() {
		this.readyState = 3
	}
}
global.WebSocket = FakeWebSocket

const spectate = await import('./spectate.js')
await spectate.ready

const $ = (id) => document.getElementById(id)
const visible = (id) => !$(id).classList.contains('hidden')

const liveState = {
	battle_id: 5,
	status: 'ACTIVE',
	turn: 10,
	turn_number: 1,
	player1_id: 10,
	player2_id: null,
	cards: {
		player1: [
			{
				slot_position: 0,
				name: 'Great Hall',
				category: 'LOCATION',
				rarity: 'COMMON',
				health: 40,
				stat_legacy: 40,
			},
		],
		player2: [
			{
				slot_position: 0,
				name: 'Origins Centre',
				category: 'LOCATION',
				rarity: 'RARE',
				health: 30,
				stat_legacy: 30,
			},
		],
	},
}

describe('spectate page', () => {
	afterEach(() => {
		spectate.stopWatching({ refresh: false })
		jest.useRealTimers()
	})

	test('shows "No live matches right now" for an empty list', () => {
		expect(visible('view-list')).toBe(true)
		expect(visible('live-empty')).toBe(true)
		expect($('live-empty').textContent).toContain(
			'No live matches right now'
		)
		expect($('btn-demo').textContent).toContain(
			'Watch a demo match'
		)
		expect($('live-list').children).toHaveLength(0)
	})

	test('lists live battles with a Watch button each', async () => {
		liveBattles = [
			{
				battle_id: 5,
				player1: { user_id: 10, name: 'Alice' },
				player2: { user_id: null, name: 'CPU' },
				current_turn: { user_id: 10, name: 'Alice' },
				turn_number: 1,
			},
		]
		await spectate.loadLiveBattles()
		liveBattles = []

		expect(visible('live-empty')).toBe(false)
		const items = $('live-list').querySelectorAll('li')
		expect(items).toHaveLength(1)
		expect(items[0].textContent).toContain('Alice vs CPU')
		expect(items[0].querySelector('button').textContent).toBe(
			'Watch'
		)
	})

	test('watch view: banner, neutral names, no action buttons, winner', () => {
		spectate.watchLive(5)
		const socket = FakeWebSocket.instances.at(-1)
		expect(socket.url).toBe(`${API_BASE_WS}/ws/spectate`)
		socket.onopen()
		expect(socket.sent[0]).toEqual({ type: 'watch', battle_id: 5 })

		const send = (msg) =>
			socket.onmessage({ data: JSON.stringify(msg) })
		send({
			type: 'state_update',
			battle_id: 5,
			state: liveState,
			players: {
				player1: { user_id: 10, name: 'Alice' },
				player2: { user_id: null, name: 'CPU' },
			},
		})

		expect(visible('view-watch')).toBe(true)
		expect(visible('view-list')).toBe(false)
		expect($('watch-banner').textContent).toContain('WATCHING')
		expect(
			$('watch-banner').querySelector('.watching-eye')
		).not.toBeNull()
		expect($('watch-title').textContent).toBe('Alice vs CPU')
		expect($('watch-turn').textContent).toBe("Alice's turn")
		expect($('p1-cards').textContent).toContain('40 / 40 HP')
		expect($('p2-cards').textContent).toContain('Origins Centre')

		// Nothing to play with: only "Stop watching" is clickable.
		const buttons = [...$('view-watch').querySelectorAll('button')]
		expect(buttons.map((b) => b.id)).toEqual(['btn-stop'])
		expect(document.getElementById('btn-forfeit')).toBeNull()
		expect(document.getElementById('action-buttons')).toBeNull()
		expect($('view-watch').textContent).not.toMatch(
			/Your turn|You\b/
		)

		const hitState = JSON.parse(JSON.stringify(liveState))
		hitState.cards.player2[0].health = 18
		send({
			type: 'turn_result',
			player_result: {
				attacker_slot: 0,
				target_slot: 0,
				action: 'ATTACK',
				landed: true,
				damage: 12,
			},
			player_user_id: 10,
			opponent_result: {
				attacker_slot: 0,
				target_slot: 0,
				action: 'ATTACK',
				landed: false,
				damage: 0,
			},
			battle_id: 5,
			state: hitState,
			winner: -1,
		})
		const log = [...$('watch-log').children].map(
			(li) => li.textContent
		)
		expect(log).toEqual([
			"CPU's Origins Centre missed Great Hall",
			"Alice's Great Hall hit Origins Centre for 12",
		])
		expect($('p2-cards').textContent).toContain('18 / 30 HP')

		send({ type: 'match_results', winner: 10 })
		expect(visible('watch-result')).toBe(true)
		expect($('watch-result-text').textContent).toContain(
			'Alice wins'
		)
		expect(socket.sent.at(-1)).toEqual({ type: 'leave' })
	})

	test('no_battle returns to the list with a message', () => {
		spectate.watchLive(99)
		const socket = FakeWebSocket.instances.at(-1)
		socket.onmessage({
			data: JSON.stringify({ type: 'no_battle' }),
		})
		expect(visible('view-list')).toBe(true)
		expect($('list-error').textContent).toMatch(/already finished/)
	})

	test('demo match renders through the same watch view', () => {
		jest.useFakeTimers()
		$('btn-demo').click()
		expect(visible('view-watch')).toBe(true)
		expect(visible('watch-demo-tag')).toBe(true)
		expect($('watch-banner').textContent).toContain('WATCHING')
		expect(
			$('watch-banner').querySelector('.watching-eye')
		).not.toBeNull()
		expect($('watch-title').textContent).toBe(
			'Thandi (demo) vs Sipho (demo)'
		)

		jest.advanceTimersByTime(2000)
		expect($('watch-log').children).toHaveLength(1)

		jest.advanceTimersByTime(2000 * 100)
		expect(visible('watch-result')).toBe(true)
		expect($('watch-result-text').textContent).toMatch(/wins!/)

		$('btn-stop').click()
		expect(visible('view-list')).toBe(true)
	})

	test('fallback names, non-attack moves and a no-winner ending', () => {
		jest.useFakeTimers()
		spectate.watchLive(5)
		const socket = FakeWebSocket.instances.at(-1)
		socket.onopen()
		jest.advanceTimersByTime(25000)
		expect(socket.sent.at(-1)).toEqual({ type: 'ping' })

		const send = (msg) =>
			socket.onmessage({ data: JSON.stringify(msg) })
		send({ type: 'turn_result', state: null }) // ignored
		expect($('watch-log').children).toHaveLength(0)

		const state = JSON.parse(JSON.stringify(liveState))
		state.turn = null
		send({
			type: 'turn_result',
			player_result: {
				attacker_slot: 0,
				target_slot: 0,
				action: 'DEFEND',
			},
			player_user_id: null,
			opponent_result: null,
			battle_id: 5,
			state,
			winner: -1,
		})
		expect($('watch-title').textContent).toBe('Player 1 vs CPU')
		expect($('watch-turn').textContent).toBe("CPU's turn")
		expect($('watch-log').textContent).toBe(
			"CPU's Origins Centre used DEFEND"
		)

		send({ type: 'error', message: 'Server error' })
		expect($('list-error').textContent).toBe('Server error')

		const errSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {})
		socket.onmessage({ data: 'garbage' }) // logged, not thrown
		expect(errSpy).toHaveBeenCalled()
		errSpy.mockRestore()
		send({ type: 'match_results', winner: 12345 })
		expect($('watch-result-text').textContent).toBe(
			'Match ended with no winner'
		)
		expect($('watch-turn').textContent).toBe('Match over')
	})

	test('describeMove copes with unknown slots', () => {
		const players = {
			player1: { user_id: 10, name: 'Alice' },
			player2: { user_id: 20, name: 'Bob' },
		}
		const miss = {
			attacker_slot: 9,
			target_slot: 9,
			action: 'ATTACK',
		}
		expect(spectate.describeMove(liveState, players, 1, miss)).toBe(
			"Alice's card missed a card"
		)
		expect(
			spectate.describeMove(liveState, players, 2, {
				...miss,
				landed: true,
				damage: 3,
			})
		).toBe("Bob's card hit a card for 3")
	})

	test('shows a message when the live socket drops mid-match', () => {
		spectate.watchLive(5)
		const socket = FakeWebSocket.instances.at(-1)
		socket.onclose()
		expect($('list-error').textContent).toMatch(/Lost connection/)
	})

	test('messages are ignored when not watching', () => {
		spectate.stopWatching({ refresh: false })
		expect(() =>
			spectate.handleMessage({
				type: 'match_results',
				winner: 1,
			})
		).not.toThrow()
	})
})

describe('spectate page errors', () => {
	const realFetch = global.fetch
	const originalLocation = window.location

	afterEach(() => {
		global.fetch = realFetch
		window.location = originalLocation
	})

	test('live list failure shows an error and the empty state', async () => {
		global.fetch = jest.fn(async () => ({ ok: false, status: 500 }))
		await spectate.loadLiveBattles()
		expect($('list-error').textContent).toMatch(
			/Could not load live matches/
		)
		expect(visible('live-empty')).toBe(true)
	})

	test('logged-out users are sent home', async () => {
		delete window.location
		window.location = { href: '' }
		global.fetch = jest.fn(async () => ({ ok: false, status: 401 }))
		await spectate.checkAccess()
		expect(window.location.href).toBe('../index.html')
	})

	test('session check failure is reported', async () => {
		global.fetch = jest.fn(async () => ({ ok: false, status: 503 }))
		await spectate.checkAccess()
		expect($('list-error').textContent).toMatch(
			/responded with 503/
		)
	})

	test('unreachable server is reported', async () => {
		global.fetch = jest.fn(async () => {
			throw new TypeError('Failed to fetch')
		})
		await spectate.checkAccess()
		expect($('list-error').textContent).toMatch(/Could not reach/)
	})
})
