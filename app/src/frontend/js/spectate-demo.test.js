import { jest } from '@jest/globals'
import {
	DEMO_BATTLE_ID,
	createDemoState,
	nextDemoMessage,
	startDemoStream,
} from './spectate-demo.js'

// Same shape checks the watch view relies on for real socket messages.
function expectValidState(state) {
	expect(state.battle_id).toBe(DEMO_BATTLE_ID)
	expect([state.player1_id, state.player2_id]).toContain(state.turn)
	for (const side of ['player1', 'player2']) {
		expect(state.cards[side].length).toBeGreaterThan(0)
		for (const card of state.cards[side]) {
			expect(card).toEqual(
				expect.objectContaining({
					slot_position: expect.any(Number),
					name: expect.any(String),
					category: expect.any(String),
					health: expect.any(Number),
					stat_legacy: expect.any(Number),
				})
			)
			expect(card.health).toBeGreaterThanOrEqual(0)
		}
	}
}

describe('spectate-demo', () => {
	afterEach(() => jest.useRealTimers())

	test('turn_result messages match the real socket shape', () => {
		const state = createDemoState()
		const msg = nextDemoMessage(state, 0)
		expect(msg).toEqual({
			type: 'turn_result',
			player_result: {
				attacker_slot: expect.any(Number),
				target_slot: expect.any(Number),
				action: 'ATTACK',
				landed: true,
				damage: expect.any(Number),
				target_health_after: expect.any(Number),
			},
			player_user_id: state.player1_id,
			opponent_result: null,
			battle_id: DEMO_BATTLE_ID,
			state: expect.any(Object),
			winner: -1,
		})
		expectValidState(msg.state)
		expect(msg.state.turn).toBe(state.player2_id)
	})

	test('stream emits state_update, turn_results every 2s, then match_results', () => {
		jest.useFakeTimers()
		const messages = []
		const stop = startDemoStream((m) => messages.push(m))

		expect(messages).toHaveLength(1)
		expect(messages[0].type).toBe('state_update')
		expect(messages[0].players.player1.name).toMatch(/demo/)
		expectValidState(messages[0].state)

		jest.advanceTimersByTime(2000)
		expect(messages).toHaveLength(2)
		expect(messages[1].type).toBe('turn_result')

		jest.advanceTimersByTime(2000 * 100)
		const last = messages.at(-1)
		expect(last.type).toBe('match_results')
		expect([9001, 9002]).toContain(last.winner)

		const turns = messages.filter((m) => m.type === 'turn_result')
		turns.forEach((m) => expectValidState(m.state))
		expect(turns.at(-1).winner).toBe(last.winner)
		expect(turns.some((m) => !m.player_result.landed)).toBe(true)

		// Stream stopped itself — no more messages.
		const count = messages.length
		jest.advanceTimersByTime(10000)
		expect(messages).toHaveLength(count)
		stop()
	})

	test('stop() halts the stream', () => {
		jest.useFakeTimers()
		const messages = []
		const stop = startDemoStream((m) => messages.push(m), 500)
		stop()
		jest.advanceTimersByTime(5000)
		expect(messages).toHaveLength(1)
	})
})
