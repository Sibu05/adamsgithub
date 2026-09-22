import { distance_meters } from '../utils/geo.js'

/**
 * Great-circle distance between two {lat, lng} points, in meters.
 * Thin wrapper around the existing haversine implementation so this
 * module can work with {lat, lng} points directly.
 */
export function haversineMeters(a, b) {
	return distance_meters(a.lat, a.lng, b.lat, b.lng)
}

/**
 * Deterministic PRNG (mulberry32) — same seed always produces the same
 * sequence of rng() calls, so a rotation run can be replayed/tested.
 */
export function createRng(seed) {
	let a = seed >>> 0
	return function rng() {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export const DEFAULT_CONFIG = {
	minSpacingMeters: 80,
	maxLive: 12,
	eventTtlMinutes: 60,
	rotationIntervalMinutes: 15,
	radiusMeters: 30,
	cooldownRotations: 3,
}

function nodeById(graph, id) {
	return graph.nodes.find((n) => n.id === id)
}

function zoneForPoint(zones, point) {
	for (const zone of zones) {
		const { west, east, south, north } = zone.bounds
		if (
			point.lng >= west &&
			point.lng <= east &&
			point.lat >= south &&
			point.lat <= north
		) {
			return zone.id
		}
	}
	return null
}

/**
 * Points spaced ~stepMeters apart along every edge of the path graph,
 * each tagged with the zone it falls in. This is the full candidate
 * pool placements are chosen from — every returned point sits exactly
 * on a walkable edge.
 */
export function sampleCandidates(graph, stepMeters = 10) {
	const zones = graph.zones ?? []
	const seen = new Set()
	const candidates = []

	for (const [fromId, toId] of graph.edges) {
		const from = nodeById(graph, fromId)
		const to = nodeById(graph, toId)
		if (!from || !to) continue

		const edgeLength = haversineMeters(from, to)
		const steps = Math.max(1, Math.round(edgeLength / stepMeters))

		for (let i = 0; i <= steps; i++) {
			const t = i / steps
			const point = {
				lat: from.lat + (to.lat - from.lat) * t,
				lng: from.lng + (to.lng - from.lng) * t,
			}
			const key = `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`
			if (seen.has(key)) continue
			seen.add(key)

			candidates.push({
				lat: point.lat,
				lng: point.lng,
				zone: zoneForPoint(zones, point),
			})
		}
	}

	return candidates
}

// Real event rows use `latitude`/`longitude` column names; other inputs
// (recentSpots, test fixtures) tend to use `lat`/`lng`. Accept either so
// callers don't have to remap before calling in.
function toPoint(obj) {
	return {
		lat: obj.lat ?? obj.latitude,
		lng: obj.lng ?? obj.longitude,
	}
}

function farEnoughFromAll(point, others, minSpacingMeters) {
	for (const other of others) {
		if (haversineMeters(point, other) < minSpacingMeters)
			return false
	}
	return true
}

function pickWeighted(items, weights, rng) {
	const total = weights.reduce((sum, w) => sum + w, 0)
	if (total <= 0) return items[Math.floor(rng() * items.length)]

	let r = rng() * total
	for (let i = 0; i < items.length; i++) {
		r -= weights[i]
		if (r <= 0) return items[i]
	}
	return items[items.length - 1]
}

// Zones that have never hosted an event get an overwhelming weight so
// they're picked ahead of any zone with a real (finite) last-used gap.
const NEVER_USED_WEIGHT = Number.MAX_SAFE_INTEGER / 2

function zoneWeight(zoneId, zoneLastUsed, now) {
	const last = zoneLastUsed?.[zoneId]
	if (last == null) return NEVER_USED_WEIGHT
	return Math.max(1, now - last)
}

/**
 * Choose new event locations along the campus path graph.
 *
 * - Never lets the live event count exceed config.maxLive.
 * - Keeps every new point >= minSpacingMeters from active events and
 *   from every other new point.
 * - Skips points within minSpacingMeters of recentSpots (cooldown).
 * - Spreads picks across zones, favouring whichever zone has gone
 *   longest without an event (weighted random via rng).
 * - If the graph can't fit maxLive, places as many as fit and stops —
 *   the candidate pool only ever shrinks each iteration, so this
 *   can't loop forever.
 *
 * @returns {{lat: number, lng: number, zone: string|null}[]}
 */
export function generatePlacements({
	graph,
	activeEvents = [],
	recentSpots = [],
	zoneLastUsed = {},
	config = {},
	rng = createRng(1),
	now = Date.now(),
}) {
	const cfg = { ...DEFAULT_CONFIG, ...config }

	const slotsAvailable = cfg.maxLive - activeEvents.length
	if (slotsAvailable <= 0) return []

	const activePoints = activeEvents.map(toPoint)
	const recentPoints = recentSpots.map(toPoint)

	let pool = sampleCandidates(graph).filter(
		(c) =>
			farEnoughFromAll(
				c,
				activePoints,
				cfg.minSpacingMeters
			) &&
			farEnoughFromAll(c, recentPoints, cfg.minSpacingMeters)
	)

	const placed = []
	const runZoneLastUsed = { ...zoneLastUsed }

	// Defensive bound only — the filter below always shrinks `pool` by at
	// least the chosen candidate, so this loop terminates on its own.
	let guard = pool.length + 1
	while (
		placed.length < slotsAvailable &&
		pool.length > 0 &&
		guard-- > 0
	) {
		const byZone = new Map()
		for (const c of pool) {
			if (!byZone.has(c.zone)) byZone.set(c.zone, [])
			byZone.get(c.zone).push(c)
		}

		const zoneIds = [...byZone.keys()]
		const weights = zoneIds.map((id) =>
			zoneWeight(id, runZoneLastUsed, now)
		)
		const chosenZone = pickWeighted(zoneIds, weights, rng)

		const zoneCandidates = byZone.get(chosenZone)
		const chosen =
			zoneCandidates[
				Math.floor(rng() * zoneCandidates.length)
			]

		placed.push({
			lat: chosen.lat,
			lng: chosen.lng,
			zone: chosen.zone,
		})
		runZoneLastUsed[chosenZone] = now

		pool = pool.filter(
			(c) =>
				haversineMeters(c, chosen) >=
				cfg.minSpacingMeters
		)
	}

	return placed
}
