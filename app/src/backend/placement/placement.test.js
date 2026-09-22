import {
	haversineMeters,
	createRng,
	sampleCandidates,
	generatePlacements,
	DEFAULT_CONFIG,
} from './placement.js'
import { FIXTURE_GRAPH as campusGraph } from './test_fixtures.js'

function minDistanceToCandidates(point, candidates) {
	let min = Infinity
	for (const c of candidates) {
		const d = haversineMeters(point, c)
		if (d < min) min = d
	}
	return min
}

function pairwiseDistances(points) {
	const dists = []
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			dists.push(haversineMeters(points[i], points[j]))
		}
	}
	return dists
}

describe('haversineMeters', () => {
	test('same point is zero distance', () => {
		const p = { lat: -26.19, lng: 28.03 }
		expect(haversineMeters(p, p)).toBeCloseTo(0, 6)
	})

	test('matches a known ~111km-per-degree-latitude approximation', () => {
		const a = { lat: -26.19, lng: 28.03 }
		const b = { lat: -26.19 + 1, lng: 28.03 }
		expect(haversineMeters(a, b)).toBeGreaterThan(110000)
		expect(haversineMeters(a, b)).toBeLessThan(112000)
	})
})

describe('createRng', () => {
	test('same seed produces the same sequence', () => {
		const rngA = createRng(42)
		const rngB = createRng(42)
		const seqA = Array.from({ length: 5 }, () => rngA())
		const seqB = Array.from({ length: 5 }, () => rngB())
		expect(seqA).toEqual(seqB)
	})

	test('different seeds produce different sequences', () => {
		const rngA = createRng(1)
		const rngB = createRng(2)
		const seqA = Array.from({ length: 5 }, () => rngA())
		const seqB = Array.from({ length: 5 }, () => rngB())
		expect(seqA).not.toEqual(seqB)
	})

	test('values stay within [0, 1)', () => {
		const rng = createRng(7)
		for (let i = 0; i < 50; i++) {
			const v = rng()
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(1)
		}
	})
})

describe('sampleCandidates', () => {
	test('every candidate is tagged with a zone from the campus graph', () => {
		const candidates = sampleCandidates(campusGraph)
		expect(candidates.length).toBeGreaterThan(0)
		const zoneIds = new Set(campusGraph.zones.map((z) => z.id))
		for (const c of candidates) {
			expect(c.zone === null || zoneIds.has(c.zone)).toBe(
				true
			)
		}
	})

	test('candidates lie within the campus bbox', () => {
		const candidates = sampleCandidates(campusGraph)
		for (const c of candidates) {
			expect(c.lng).toBeGreaterThanOrEqual(28.017)
			expect(c.lng).toBeLessThanOrEqual(28.05)
			expect(c.lat).toBeGreaterThanOrEqual(-26.198)
			expect(c.lat).toBeLessThanOrEqual(-26.173)
		}
	})
})

describe('generatePlacements — on-graph', () => {
	test('every placement lies on a path edge (within 1m)', () => {
		const candidates = sampleCandidates(campusGraph)
		const placements = generatePlacements({
			graph: campusGraph,
			rng: createRng(1),
			now: 1000,
		})
		expect(placements.length).toBeGreaterThan(0)
		for (const p of placements) {
			expect(
				minDistanceToCandidates(p, candidates)
			).toBeLessThanOrEqual(1)
		}
	})
})

describe('generatePlacements — spacing', () => {
	test('no pair of new placements is closer than minSpacingMeters', () => {
		const placements = generatePlacements({
			graph: campusGraph,
			config: { maxLive: 8, minSpacingMeters: 80 },
			rng: createRng(3),
			now: 1000,
		})
		for (const d of pairwiseDistances(placements)) {
			expect(d).toBeGreaterThanOrEqual(80)
		}
	})

	test('every placement stays minSpacingMeters away from active events', () => {
		const activeEvents = [
			{ lat: -26.195, lng: 28.019 }, // sits on n1
			{ latitude: -26.183, longitude: 28.038 }, // n12, snake_case shape
		]
		const placements = generatePlacements({
			graph: campusGraph,
			activeEvents,
			config: { maxLive: 6, minSpacingMeters: 80 },
			rng: createRng(5),
			now: 1000,
		})
		for (const p of placements) {
			for (const active of activeEvents) {
				const activePoint = {
					lat: active.lat ?? active.latitude,
					lng: active.lng ?? active.longitude,
				}
				expect(
					haversineMeters(p, activePoint)
				).toBeGreaterThanOrEqual(80)
			}
		}
	})
})

describe('generatePlacements — maxLive', () => {
	test('never returns more than maxLive minus current live count', () => {
		const placements = generatePlacements({
			graph: campusGraph,
			config: { maxLive: 3 },
			rng: createRng(1),
			now: 1000,
		})
		expect(placements.length).toBeLessThanOrEqual(3)
		expect(placements.length).toBeGreaterThan(0)
	})

	test('returns nothing once maxLive is already reached', () => {
		const activeEvents = Array.from({ length: 12 }, (_, i) => ({
			lat: -26.195,
			lng: 28.019 + i * 0.001,
		}))
		const placements = generatePlacements({
			graph: campusGraph,
			activeEvents,
			config: { maxLive: 12 },
			rng: createRng(1),
			now: 1000,
		})
		expect(placements).toEqual([])
	})
})

describe('generatePlacements — determinism', () => {
	test('same seed gives the same output', () => {
		const args = (seed) => ({
			graph: campusGraph,
			config: { maxLive: 6 },
			rng: createRng(seed),
			now: 1000,
		})
		const a = generatePlacements(args(99))
		const b = generatePlacements(args(99))
		expect(a).toEqual(b)
	})

	test('different seeds give different output', () => {
		const a = generatePlacements({
			graph: campusGraph,
			config: { maxLive: 6 },
			rng: createRng(1),
			now: 1000,
		})
		const b = generatePlacements({
			graph: campusGraph,
			config: { maxLive: 6 },
			rng: createRng(2),
			now: 1000,
		})
		expect(a).not.toEqual(b)
	})
})

describe('generatePlacements — zone preference', () => {
	test('prefers the zone that has gone longest without an event', () => {
		// All zones "just used" except science_stadium, which has never
		// hosted an event — its weight should dominate the roulette-wheel
		// pick by many orders of magnitude, so the first placement lands
		// there regardless of rng seed.
		const zoneLastUsed = {
			west_campus: 999,
			great_hall: 999,
			library_lawns: 999,
			east_campus: 999,
			// science_stadium intentionally absent (never used)
		}
		for (const seed of [1, 2, 3, 4, 5]) {
			const placements = generatePlacements({
				graph: campusGraph,
				config: { maxLive: 1 },
				zoneLastUsed,
				rng: createRng(seed),
				now: 1000,
			})
			expect(placements[0].zone).toBe('science_stadium')
		}
	})
})

describe('generatePlacements — cooldown', () => {
	test('avoids recentSpots within minSpacingMeters', () => {
		const candidates = sampleCandidates(campusGraph)
		const recentSpots = candidates.slice(0, 20) // a big cooled-down patch
		const placements = generatePlacements({
			graph: campusGraph,
			recentSpots,
			config: { maxLive: 6, minSpacingMeters: 80 },
			rng: createRng(1),
			now: 1000,
		})
		for (const p of placements) {
			for (const spot of recentSpots) {
				expect(
					haversineMeters(p, spot)
				).toBeGreaterThanOrEqual(80)
			}
		}
	})
})

describe('generatePlacements — tiny graph', () => {
	test('does not hang and respects spacing on a graph too small for maxLive', () => {
		const tinyGraph = {
			nodes: [
				{ id: 'a', lat: -26.19, lng: 28.03 },
				{ id: 'b', lat: -26.19, lng: 28.0301 }, // ~10m from a
			],
			edges: [['a', 'b']],
			zones: [
				{
					id: 'only_zone',
					name: 'Only Zone',
					bounds: {
						west: 28.0,
						east: 28.04,
						south: -26.2,
						north: -26.18,
					},
				},
			],
		}

		const placements = generatePlacements({
			graph: tinyGraph,
			config: { maxLive: 12, minSpacingMeters: 80 },
			rng: createRng(1),
			now: 1000,
		})

		// The whole graph spans ~10m, so only one point >= 80m apart can
		// ever be chosen — the important thing is this returns at all.
		expect(placements.length).toBeLessThanOrEqual(1)
	})
})

describe('DEFAULT_CONFIG', () => {
	test('matches the agreed rotation defaults', () => {
		expect(DEFAULT_CONFIG).toEqual({
			minSpacingMeters: 80,
			maxLive: 12,
			eventTtlMinutes: 60,
			rotationIntervalMinutes: 15,
			radiusMeters: 30,
			cooldownRotations: 3,
		})
	})
})
