import {
	TEAM_ACTIONS,
	add_effect,
	get_effective_stat,
	apply_defence,
	tick_effects,
	apply_buff,
	apply_debuff,
	apply_defence_stance,
	apply_revive,
} from './battle_effects.js'

// ── Fixtures ────────────────────────────────────────────────

function makeCard(overrides = {}) {
	return {
		slot_position: 0,
		health: 50,
		stat_attack: 10,
		stat_location: 20,
		stat_legacy: 50,
		...overrides,
	}
}

function makeState(player1 = [], player2 = []) {
	return { cards: { player1, player2 } }
}

// ── Tests ───────────────────────────────────────────────────

describe('add_effect', () => {
	test('creates the effects list on a card that has none', () => {
		const card = makeCard()
		add_effect(card, {
			type: 'BUFF',
			stat: 'stat_attack',
			amount: 5,
		})
		expect(card.effects).toHaveLength(1)
	})

	test('appends to an existing effects list', () => {
		const card = makeCard({
			effects: [{ type: 'DEFEND', amount: 1 }],
		})
		add_effect(card, {
			type: 'BUFF',
			stat: 'stat_attack',
			amount: 5,
		})
		expect(card.effects.map((e) => e.type)).toEqual([
			'DEFEND',
			'BUFF',
		])
	})
})

describe('get_effective_stat', () => {
	test('returns the base stat when there are no effects', () => {
		expect(get_effective_stat(makeCard(), 'stat_attack')).toBe(10)
	})

	test('treats a missing stat as 0', () => {
		expect(get_effective_stat(makeCard(), 'stat_era')).toBe(0)
	})

	test('sums only the effects that target the requested stat', () => {
		const card = makeCard({
			effects: [
				{
					type: 'BUFF',
					stat: 'stat_attack',
					amount: 10,
				},
				{
					type: 'DEBUFF',
					stat: 'stat_attack',
					amount: -4,
				},
				{
					type: 'BUFF',
					stat: 'stat_location',
					amount: 99,
				},
				{ type: 'DEFEND', stat: null, amount: 7 },
			],
		})
		expect(get_effective_stat(card, 'stat_attack')).toBe(16)
		expect(get_effective_stat(card, 'stat_location')).toBe(119)
	})

	test('never drops below 0', () => {
		const card = makeCard({
			effects: [
				{
					type: 'DEBUFF',
					stat: 'stat_attack',
					amount: -50,
				},
			],
		})
		expect(get_effective_stat(card, 'stat_attack')).toBe(0)
	})
})

describe('apply_defence', () => {
	test('passes damage straight through without a DEFEND effect', () => {
		expect(apply_defence(makeCard(), 12)).toBe(12)
		const buffed = makeCard({
			effects: [
				{
					type: 'BUFF',
					stat: 'stat_attack',
					amount: 5,
				},
			],
		})
		expect(apply_defence(buffed, 12)).toBe(12)
		expect(buffed.effects).toHaveLength(1)
	})

	test('absorbs damage and is consumed on hit', () => {
		const card = makeCard({
			effects: [
				{
					type: 'BUFF',
					stat: 'stat_attack',
					amount: 5,
				},
				{ type: 'DEFEND', stat: null, amount: 4 },
			],
		})
		expect(apply_defence(card, 10)).toBe(6)
		expect(card.effects.map((e) => e.type)).toEqual(['BUFF'])
	})

	test('only one DEFEND is consumed per hit, and damage floors at 0', () => {
		const card = makeCard({
			effects: [
				{ type: 'DEFEND', stat: null, amount: 20 },
				{ type: 'DEFEND', stat: null, amount: 20 },
			],
		})
		expect(apply_defence(card, 5)).toBe(0)
		expect(card.effects).toHaveLength(1)
	})
})

describe('tick_effects', () => {
	test('skips cards with no effects', () => {
		const bare = makeCard()
		const empty = makeCard({ effects: [] })
		tick_effects(makeState([bare], [empty]))
		expect(bare.effects).toBeUndefined()
		expect(empty.effects).toEqual([])
	})

	test('DEFEND never expires from ticking', () => {
		const card = makeCard({
			effects: [{ type: 'DEFEND', stat: null, amount: 3 }],
		})
		tick_effects(makeState([card]))
		tick_effects(makeState([card]))
		expect(card.effects).toEqual([
			{ type: 'DEFEND', stat: null, amount: 3 },
		])
	})

	test('counts down timed effects and drops them at 0', () => {
		const buff = {
			type: 'BUFF',
			stat: 'stat_attack',
			amount: 5,
			duration: 2,
		}
		const debuff = {
			type: 'DEBUFF',
			stat: 'stat_location',
			amount: -5,
			duration: 1,
		}
		const card = makeCard({ effects: [buff, debuff] })

		tick_effects(makeState([], [card]))
		expect(card.effects).toEqual([{ ...buff, duration: 1 }])

		tick_effects(makeState([], [card]))
		expect(card.effects).toEqual([])
	})

	test('an expiring REVIVE knocks the card back out', () => {
		const card = makeCard({ health: 0 })
		apply_revive(card, 25, 2)

		tick_effects(makeState([card]))
		expect(card.health).toBe(25)

		tick_effects(makeState([card]))
		expect(card.health).toBe(0)
		expect(card.effects).toEqual([])
	})
})

describe('effect builders', () => {
	test('apply_buff tags the effect with the source slot', () => {
		const source = makeCard({ slot_position: 3 })
		const target = makeCard()
		expect(
			apply_buff(source, target, 'stat_attack', 10, 2)
		).toEqual({
			applied: true,
			stat: 'stat_attack',
			amount: 10,
			duration: 2,
		})
		expect(target.effects).toEqual([
			{
				type: 'BUFF',
				stat: 'stat_attack',
				amount: 10,
				duration: 2,
				source_slot: 3,
			},
		])
		expect(get_effective_stat(target, 'stat_attack')).toBe(20)
	})

	test.each([10, -10])(
		'apply_debuff always stores a negative amount (given %i)',
		(amount) => {
			const target = makeCard()
			const result = apply_debuff(
				makeCard({ slot_position: 1 }),
				target,
				'stat_attack',
				amount,
				2
			)
			expect(result.amount).toBe(-10)
			expect(target.effects[0]).toMatchObject({
				type: 'DEBUFF',
				amount: -10,
				source_slot: 1,
			})
			expect(get_effective_stat(target, 'stat_attack')).toBe(
				0
			)
		}
	)

	test('apply_defence_stance adds an untimed DEFEND', () => {
		const card = makeCard()
		expect(apply_defence_stance(card, 5)).toEqual({
			applied: true,
			amount: 5,
		})
		expect(card.effects).toEqual([
			{
				type: 'DEFEND',
				stat: null,
				amount: 5,
				duration: null,
			},
		])
	})

	test('apply_revive only works on a defeated card', () => {
		const alive = makeCard({ health: 1 })
		expect(apply_revive(alive, 25, 3)).toEqual({
			applied: false,
			reason: 'Target is not defeated',
		})
		expect(alive.effects).toBeUndefined()

		const fallen = makeCard({ health: 0 })
		expect(apply_revive(fallen, 25, 3)).toEqual({
			applied: true,
			health: 25,
			duration: 3,
		})
		expect(fallen.health).toBe(25)
		expect(fallen.effects).toEqual([
			{ type: 'REVIVE', stat: null, amount: 0, duration: 3 },
		])
	})

	test('TEAM_ACTIONS lists the actions that target your own cards', () => {
		expect(TEAM_ACTIONS).toEqual([
			'DEFEND',
			'DODGE',
			'REVIVE',
			'BUFF',
		])
	})
})
