/**
 * Client-side fake battle stream for the spectate page.
 *
 * Emits exactly the message shapes the real /ws/spectate socket forwards
 * (state_update → turn_result… → match_results) so the watch view renders
 * a demo match and a real match through the same code path. No server,
 * no randomness: the same demo plays out identically every time.
 */

export const DEMO_BATTLE_ID = 'demo'
export const DEMO_INTERVAL_MS = 2000

const DEMO_P1 = { user_id: 9001, name: 'Thandi (demo)' }
const DEMO_P2 = { user_id: 9002, name: 'Sipho (demo)' }

function demoCard(slot_position, name, category, stat_attack, stat_legacy) {
	return {
		deck_id: slot_position,
		slot_position,
		card_id: slot_position,
		name,
		image_url: '',
		category,
		rarity: 'COMMON',
		health: stat_legacy,
		stat_attack,
		stat_location: 20,
		stat_influence: 20,
		stat_legacy,
		stat_era: 1950,
		effects: [],
	}
}

export function createDemoState() {
	return {
		battle_id: DEMO_BATTLE_ID,
		status: 'ACTIVE',
		turn: DEMO_P1.user_id,
		turn_number: 1,
		player1_id: DEMO_P1.user_id,
		player2_id: DEMO_P2.user_id,
		cards: {
			player1: [
				demoCard(0, 'Great Hall', 'LOCATION', 12, 34),
				demoCard(
					1,
					'Nelson Mandela',
					'CHARACTER',
					18,
					30
				),
				demoCard(2, 'Wits 1922', 'HISTORICAL', 14, 28),
			],
			player2: [
				demoCard(
					0,
					'Origins Centre',
					'LOCATION',
					13,
					32
				),
				demoCard(
					1,
					'Phillip Tobias',
					'CHARACTER',
					16,
					30
				),
				demoCard(
					2,
					'Student Union',
					'INFLUENCE',
					15,
					30
				),
			],
		},
	}
}

export function demoPlayers() {
	return { player1: { ...DEMO_P1 }, player2: { ...DEMO_P2 } }
}

export function initialDemoMessage(state) {
	return {
		type: 'state_update',
		battle_id: DEMO_BATTLE_ID,
		state,
		players: demoPlayers(),
	}
}

/* Play one move for whoever's turn it is. Mutates `state` and returns
 * the turn_result message for it.
 */
export function nextDemoMessage(state, move_number) {
	const acting_p1 = state.turn === state.player1_id
	const own = acting_p1 ? state.cards.player1 : state.cards.player2
	const other = acting_p1 ? state.cards.player2 : state.cards.player1

	const alive_own = own.filter((c) => c.health > 0)
	const alive_other = other.filter((c) => c.health > 0)
	const attacker = alive_own[move_number % alive_own.length]
	const target = alive_other[0]

	// Every fifth swing whiffs, so the log shows both outcomes.
	const landed = move_number % 5 !== 4
	const damage = landed ? attacker.stat_attack : 0
	target.health = Math.max(0, target.health - damage)

	const winner = other.some((c) => c.health > 0) ? -1 : state.turn

	const msg = {
		type: 'turn_result',
		player_result: {
			attacker_slot: attacker.slot_position,
			target_slot: target.slot_position,
			action: 'ATTACK',
			landed,
			damage,
			target_health_after: target.health,
		},
		player_user_id: state.turn,
		opponent_result: null,
		battle_id: DEMO_BATTLE_ID,
		state: null,
		winner,
	}

	if (winner === -1) {
		state.turn = acting_p1 ? state.player2_id : state.player1_id
		state.turn_number += 0.5
	}
	// Snapshot so later moves don't rewrite messages already sent.
	msg.state = JSON.parse(JSON.stringify(state))
	return msg
}

/* Start streaming the demo into `onMessage`. Returns a stop() function. */
export function startDemoStream(onMessage, intervalMs = DEMO_INTERVAL_MS) {
	const state = createDemoState()
	let move = 0
	let timer = null

	const stop = () => {
		if (timer !== null) clearInterval(timer)
		timer = null
	}

	onMessage(initialDemoMessage(JSON.parse(JSON.stringify(state))))

	timer = setInterval(() => {
		const msg = nextDemoMessage(state, move++)
		onMessage(msg)
		if (msg.winner !== -1) {
			stop()
			onMessage({ type: 'match_results', winner: msg.winner })
		}
	}, intervalMs)

	return stop
}
