#!/usr/bin/env node
/**
 * fetch_osm_paths.js — one-off script, NOT run at server startup.
 *
 * Rebuilds app/src/backend/placement/campus_paths.json from REAL Wits
 * Braamfontein campus walkway data on OpenStreetMap, replacing the
 * hand-made grid placement chunk 1 shipped with.
 *
 * Usage:
 *   node app/src/backend/placement/scripts/fetch_osm_paths.js
 *   node app/src/backend/placement/scripts/fetch_osm_paths.js --from-file placement/scripts/wits_paths.geojson
 *   node app/src/backend/placement/scripts/fetch_osm_paths.js --from-file <path> --out <path>
 *
 * What it does:
 *   1. Gets the Wits campus boundary + walkway ways (highway=footway,
 *      pedestrian, path, steps, living_street), plus internal campus
 *      roads (highway=service, unclassified, residential, track,
 *      cycleway) — either live from the Overpass API, or from a local
 *      GeoJSON export (--from-file), so it still works if Overpass is
 *      unreachable or rate-limited.
 *   2. Keeps only points inside the campus boundary (when a boundary
 *      polygon was found). The campus-road types are dropped entirely
 *      when no boundary was found, so public roads never leak in.
 *   3. Builds a {nodes, edges} graph in the same shape placement.js
 *      already consumes — merging nodes that share a coordinate (to
 *      ~11cm) so shared intersections become a single graph node, and
 *      dropping components smaller than MIN_COMPONENT_SIZE (mapping
 *      noise / disconnected stubs).
 *   4. Builds 5-6 zones from real named places found in the data
 *      (buildings/amenities matching a curated list of Wits landmark
 *      keywords), each a small bounding box around that place. Falls
 *      back to generic quadrant zones over the graph's own bbox if
 *      fewer than 5 named landmarks turn up (e.g. when --from-file only
 *      has footway data, no named places).
 *   5. Writes the result — with an OSM attribution note — over
 *      campus_paths.json (or --out).
 *
 * Data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
 * Licensed ODbL — see the "_attribution" field this script writes.
 */

import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DEFAULT_OUT = path.join(__dirname, '..', 'campus_paths.json')

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const OVERPASS_HEADERS = {
	Accept: '*/*',
	'User-Agent':
		'Adamas2Aurum-PlacementScript/1.0 (student project; one-off data fetch)',
}

const ALLOWED_HIGHWAYS = new Set([
	'footway',
	'pedestrian',
	'path',
	'steps',
	'living_street',
])

// Road types that are only walkable for our purposes when they're INSIDE
// the campus boundary (campus-internal roads) — never public roads
// outside it. Only used when a boundary polygon was found.
const CAMPUS_ONLY_HIGHWAYS = new Set([
	'service',
	'unclassified',
	'residential',
	'track',
	'cycleway',
])

// Drop connected components smaller than this — almost always mapping
// noise (an unlinked step, a stub with no other connection).
const MIN_COMPONENT_SIZE = 3

// Half-width (meters) of the bounding box drawn around each named-landmark
// zone centroid.
const ZONE_HALF_WIDTH_METERS = 90

// Curated so the zones we end up with actually mean something to a
// player standing on campus, rather than picking 6 random named nodes.
// Matched case-insensitively as a substring against OSM `name` tags.
const LANDMARK_KEYWORDS = [
	'great hall',
	'library',
	'matrix',
	'science stadium',
	'wartenweiler',
	'senate house',
	'university corner',
	'origins centre',
	'planetarium',
	'west campus',
	'east campus',
	'br stadium',
	'convocation',
	'chamber of mines',
	'oppenheimer',
	'solomon mahlangu',
	'wits club',
]

// The single Overpass QL query used both by this script's live fetch AND
// given to the user for Overpass Turbo (see the --from-file failure
// message below) — keep these in sync if you change one.
export const OVERPASS_QUERY = `[out:json][timeout:90];
area["name"~"Witwatersrand",i]["amenity"="university"]->.campus;
(
  way(area.campus)["highway"~"^(footway|pedestrian|path|steps|living_street|service|unclassified|residential|track|cycleway)$"];
  way["name"~"Witwatersrand",i]["amenity"="university"];
  relation["name"~"Witwatersrand",i]["amenity"="university"];
  node(area.campus)["name"]["building"];
  way(area.campus)["name"]["building"];
  node(area.campus)["name"]["amenity"];
  way(area.campus)["name"]["amenity"];
);
out body;
>;
out skel qt;`

// ── CLI args ────────────────────────────────────────────────────
function parseArgs(argv) {
	const args = { fromFile: null, out: DEFAULT_OUT }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--from-file') args.fromFile = argv[++i]
		else if (argv[i] === '--out') args.out = path.resolve(argv[++i])
	}
	return args
}

// ── Geometry helpers ────────────────────────────────────────────

function haversineMeters(a, b) {
	const R = 6371000
	const toRad = (d) => (d * Math.PI) / 180
	const dLat = toRad(b.lat - a.lat)
	const dLng = toRad(b.lng - a.lng)
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a.lat)) *
			Math.cos(toRad(b.lat)) *
			Math.sin(dLng / 2) ** 2
	return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

// Standard ray-casting point-in-polygon. `ring` is [{lat,lng}, ...].
function pointInRing(point, ring) {
	let inside = false
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i].lng,
			yi = ring[i].lat
		const xj = ring[j].lng,
			yj = ring[j].lat
		const intersects =
			yi > point.lat !== yj > point.lat &&
			point.lng <
				((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
		if (intersects) inside = !inside
	}
	return inside
}

function pointInAnyPolygon(point, polygons) {
	if (!polygons.length) return true // no boundary known — don't filter
	return polygons.some((ring) => pointInRing(point, ring))
}

// A small lat/lng bounding box of the given half-width (meters) around a
// centroid — same idea as campus_paths.json's existing zone `bounds`.
function bufferBounds(center, halfWidthMeters) {
	const dLat = halfWidthMeters / 110540
	const dLng =
		halfWidthMeters /
		(111320 * Math.cos((center.lat * Math.PI) / 180))
	return {
		west: center.lng - dLng,
		east: center.lng + dLng,
		south: center.lat - dLat,
		north: center.lat + dLat,
	}
}

// ── Graph building (shared by both live-Overpass and --from-file) ──

/**
 * @param {Array<Array<{lat,lng}>>} polylines
 * @param {Array<Array<{lat,lng}>>} boundaryPolygons - rings; [] = no filter
 */
function buildGraph(polylines, boundaryPolygons) {
	const idByKey = new Map()
	const nodes = []
	const edgeKeys = new Set()
	const edges = []

	// ~11cm precision — merges genuinely-shared intersections without
	// conflating distinct nearby points.
	const keyOf = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

	function nodeIdFor(p) {
		const key = keyOf(p)
		let id = idByKey.get(key)
		if (id == null) {
			id = `n${nodes.length + 1}`
			idByKey.set(key, id)
			nodes.push({ id, lat: p.lat, lng: p.lng })
		}
		return id
	}

	for (const line of polylines) {
		// A way that dips outside the boundary is only connected between
		// consecutive inside points — the stretch outside is dropped and
		// never bridged by an edge across the gap.
		for (let i = 0; i < line.length - 1; i++) {
			if (
				!pointInAnyPolygon(line[i], boundaryPolygons) ||
				!pointInAnyPolygon(
					line[i + 1],
					boundaryPolygons
				)
			)
				continue
			const a = nodeIdFor(line[i])
			const b = nodeIdFor(line[i + 1])
			if (a === b) continue
			const key = a < b ? `${a}|${b}` : `${b}|${a}`
			if (edgeKeys.has(key)) continue
			edgeKeys.add(key)
			edges.push([a, b])
		}
	}

	return dropTinyComponents({ nodes, edges })
}

function dropTinyComponents({ nodes, edges }) {
	const adjacency = new Map(nodes.map((n) => [n.id, []]))
	for (const [a, b] of edges) {
		adjacency.get(a)?.push(b)
		adjacency.get(b)?.push(a)
	}

	const seen = new Set()
	const components = []
	for (const node of nodes) {
		if (seen.has(node.id)) continue
		const stack = [node.id]
		const component = []
		seen.add(node.id)
		while (stack.length) {
			const id = stack.pop()
			component.push(id)
			for (const next of adjacency.get(id) ?? []) {
				if (!seen.has(next)) {
					seen.add(next)
					stack.push(next)
				}
			}
		}
		components.push(component)
	}

	const keptIds = new Set(
		components.filter((c) => c.length >= MIN_COMPONENT_SIZE).flat()
	)

	const keptNodesOld = nodes.filter((n) => keptIds.has(n.id))
	const keptEdgesOld = edges.filter(
		([a, b]) => keptIds.has(a) && keptIds.has(b)
	)

	// Renumber sequentially for a clean, stable output file.
	const renumber = new Map(
		keptNodesOld.map((n, i) => [n.id, `n${i + 1}`])
	)
	const nodesOut = keptNodesOld.map((n) => ({
		id: renumber.get(n.id),
		lat: n.lat,
		lng: n.lng,
	}))
	const edgesOut = keptEdgesOld.map(([a, b]) => [
		renumber.get(a),
		renumber.get(b),
	])

	return { nodes: nodesOut, edges: edgesOut }
}

// ── Zones ───────────────────────────────────────────────────────

function buildZonesFromLandmarks(namedFeatures) {
	const seenNames = new Set()
	const zones = []
	for (const kw of LANDMARK_KEYWORDS) {
		const match = namedFeatures.find(
			(f) =>
				f.name.toLowerCase().includes(kw) &&
				!seenNames.has(f.name)
		)
		if (!match) continue
		seenNames.add(match.name)
		zones.push({
			id: slugify(match.name),
			name: match.name,
			bounds: bufferBounds(
				{ lat: match.lat, lng: match.lng },
				ZONE_HALF_WIDTH_METERS
			),
		})
		if (zones.length >= 6) break
	}
	return zones
}

// Generic fallback: quadrant the graph's own bounding box into 5 named
// regions — used when real named-landmark data isn't available (e.g. a
// --from-file export that only contains footways).
function buildFallbackZones(nodes) {
	const lats = nodes.map((n) => n.lat)
	const lngs = nodes.map((n) => n.lng)
	const south = Math.min(...lats)
	const north = Math.max(...lats)
	const west = Math.min(...lngs)
	const east = Math.max(...lngs)
	const midLat = (south + north) / 2
	const midLng = (west + east) / 2
	return [
		{
			id: 'west_campus',
			name: 'West Campus',
			bounds: { west, east: midLng, south, north },
		},
		{
			id: 'north_campus',
			name: 'North Campus',
			bounds: { west: midLng, east, south: midLat, north },
		},
		{
			id: 'south_campus',
			name: 'South Campus',
			bounds: { west: midLng, east, south, north: midLat },
		},
		{
			id: 'central_campus',
			name: 'Central Campus',
			bounds: {
				west: west + (east - west) * 0.25,
				east: west + (east - west) * 0.75,
				south: south + (north - south) * 0.25,
				north: south + (north - south) * 0.75,
			},
		},
		{
			id: 'east_campus',
			name: 'East Campus',
			bounds: { west: midLng, east, south, north },
		},
	]
}

function slugify(name) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'zone'
	)
}

// ── Overpass (live) ─────────────────────────────────────────────

async function fetchFromOverpass() {
	const res = await fetch(OVERPASS_URL, {
		method: 'POST',
		headers: {
			...OVERPASS_HEADERS,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
	})
	if (!res.ok) {
		throw new Error(
			`Overpass API returned ${res.status} ${res.statusText}`
		)
	}
	const json = await res.json()
	return overpassElementsToSources(json.elements ?? [])
}

// Splits Overpass's flat `elements` array into the three things we need:
// footway polylines, campus boundary polygon(s), and named landmarks.
function overpassElementsToSources(elements) {
	const nodesById = new Map()
	for (const el of elements) {
		if (el.type === 'node')
			nodesById.set(el.id, { lat: el.lat, lng: el.lon })
	}

	const polylines = []
	const campusRoadPolylines = []
	const boundaryPolygons = []
	const namedFeatures = []

	for (const el of elements) {
		const tags = el.tags ?? {}

		if (el.type === 'way' && ALLOWED_HIGHWAYS.has(tags.highway)) {
			const line = (el.nodes ?? [])
				.map((id) => nodesById.get(id))
				.filter(Boolean)
			if (line.length >= 2) polylines.push(line)
			continue
		}

		if (
			el.type === 'way' &&
			CAMPUS_ONLY_HIGHWAYS.has(tags.highway)
		) {
			const line = (el.nodes ?? [])
				.map((id) => nodesById.get(id))
				.filter(Boolean)
			if (line.length >= 2) campusRoadPolylines.push(line)
			continue
		}

		if (
			tags.amenity === 'university' &&
			/witwatersrand/i.test(tags.name ?? '')
		) {
			const ring = wayGeometryToRing(el, nodesById)
			if (ring) boundaryPolygons.push(ring)
			continue
		}

		if (tags.name && (tags.building || tags.amenity)) {
			const center = elementCenter(el, nodesById)
			if (center)
				namedFeatures.push({
					name: tags.name,
					...center,
				})
		}
	}

	return {
		polylines,
		campusRoadPolylines,
		boundaryPolygons,
		namedFeatures,
	}
}

function wayGeometryToRing(way, nodesById) {
	if (way.type !== 'way') return null
	const ring = (way.nodes ?? [])
		.map((id) => nodesById.get(id))
		.filter(Boolean)
	return ring.length >= 3 ? ring : null
}

function elementCenter(el, nodesById) {
	if (el.type === 'node') return { lat: el.lat, lng: el.lon }
	if (el.center) return { lat: el.center.lat, lng: el.center.lon }
	if (el.type === 'way' && el.nodes?.length) {
		const pts = el.nodes
			.map((id) => nodesById.get(id))
			.filter(Boolean)
		if (!pts.length) return null
		const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
		const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
		return { lat, lng }
	}
	return null
}

// ── GeoJSON (--from-file) ───────────────────────────────────────

function geojsonToSources(geojson) {
	const polylines = []
	const campusRoadPolylines = []
	const boundaryPolygons = []
	const namedFeatures = []

	for (const f of geojson.features ?? []) {
		const tags = f.properties?.tags ?? f.properties ?? {}
		const geom = f.geometry
		if (!geom) continue

		// A full map export also has untagged-highway LineStrings (fences,
		// walls, railways...) — only highway-tagged ways are paths.
		if (
			geom.type === 'LineString' &&
			ALLOWED_HIGHWAYS.has(tags.highway)
		) {
			polylines.push(
				geom.coordinates.map(([lng, lat]) => ({
					lat,
					lng,
				}))
			)
			continue
		}

		if (
			geom.type === 'LineString' &&
			CAMPUS_ONLY_HIGHWAYS.has(tags.highway)
		) {
			campusRoadPolylines.push(
				geom.coordinates.map(([lng, lat]) => ({
					lat,
					lng,
				}))
			)
			continue
		}

		if (
			tags.amenity === 'university' &&
			/witwatersrand/i.test(tags.name ?? '') &&
			(geom.type === 'Polygon' ||
				geom.type === 'MultiPolygon')
		) {
			const rings =
				geom.type === 'Polygon'
					? [geom.coordinates[0]]
					: geom.coordinates.map((p) => p[0])
			for (const ring of rings) {
				boundaryPolygons.push(
					ring.map(([lng, lat]) => ({ lat, lng }))
				)
			}
			continue
		}

		if (tags.name && (tags.building || tags.amenity)) {
			const center = geojsonCenter(geom)
			if (center)
				namedFeatures.push({
					name: tags.name,
					...center,
				})
		}
	}

	return {
		polylines,
		campusRoadPolylines,
		boundaryPolygons,
		namedFeatures,
	}
}

function geojsonCenter(geom) {
	if (geom.type === 'Point') {
		const [lng, lat] = geom.coordinates
		return { lat, lng }
	}
	const flat =
		geom.type === 'Polygon'
			? geom.coordinates[0]
			: geom.type === 'LineString'
				? geom.coordinates
				: null
	if (!flat?.length) return null
	const lat = flat.reduce((s, [, y]) => s + y, 0) / flat.length
	const lng = flat.reduce((s, [x]) => s + x, 0) / flat.length
	return { lat, lng }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs(process.argv.slice(2))

	let sources
	if (args.fromFile) {
		const filePath = path.resolve(args.fromFile)
		console.log(`Reading local GeoJSON export: ${filePath}`)
		const geojson = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
		sources = geojsonToSources(geojson)
	} else {
		console.log(
			'Querying the Overpass API for Wits campus walkways...'
		)
		try {
			sources = await fetchFromOverpass()
		} catch (err) {
			console.error(
				`\nOverpass request failed: ${err.message}`
			)
			console.error(
				'\nThe public Overpass endpoint is sometimes unreachable or ' +
					'overloaded. Run this script again with --from-file pointing ' +
					'at a manually-exported GeoJSON instead — see the project docs ' +
					'for the Overpass Turbo query and export steps.'
			)
			process.exitCode = 1
			return
		}
	}

	const hasBoundary = sources.boundaryPolygons.length > 0
	if (!hasBoundary && sources.campusRoadPolylines.length) {
		console.log(
			`No campus boundary found — ignoring ${sources.campusRoadPolylines.length} ` +
				'service/unclassified/residential/track/cycleway way(s) so public roads are not included.'
		)
	}
	const polylines = hasBoundary
		? [...sources.polylines, ...sources.campusRoadPolylines]
		: sources.polylines

	if (!polylines.length) {
		console.error(
			'No walkway ways found in the source data — nothing to build. ' +
				'Check the query/export actually matched footway/pedestrian/path/steps/living_street ways.'
		)
		process.exitCode = 1
		return
	}

	const { nodes, edges } = buildGraph(polylines, sources.boundaryPolygons)

	if (nodes.length < 2 || edges.length < 1) {
		console.error(
			`Graph too small after filtering (${nodes.length} nodes, ${edges.length} edges) — ` +
				'refusing to overwrite campus_paths.json with something unusable.'
		)
		process.exitCode = 1
		return
	}

	// Zones only from landmarks on campus — a full-area export also has
	// e.g. public libraries off campus that match the keywords.
	let zones = buildZonesFromLandmarks(
		sources.namedFeatures.filter((f) =>
			pointInAnyPolygon(f, sources.boundaryPolygons)
		)
	)
	if (zones.length < 5) {
		console.log(
			`Only found ${zones.length} recognisable named landmark(s) — falling back to generic quadrant zones.`
		)
		zones = buildFallbackZones(nodes)
	}

	const output = {
		_attribution: 'Path data © OpenStreetMap contributors (ODbL)',
		_comment:
			'Walkable path graph for Wits main campus (Braamfontein), built from ' +
			'OpenStreetMap data by scripts/fetch_osm_paths.js. Regenerate rather ' +
			'than hand-edit.',
		nodes,
		edges,
		zones,
	}

	fs.writeFileSync(args.out, JSON.stringify(output, null, '\t') + '\n')

	// Rough edge-length sanity check, just for the console summary.
	const totalMeters = edges.reduce((sum, [a, b]) => {
		const from = nodes.find((n) => n.id === a)
		const to = nodes.find((n) => n.id === b)
		return sum + haversineMeters(from, to)
	}, 0)

	console.log(`\nWrote ${args.out}`)
	console.log(`  nodes: ${nodes.length}`)
	console.log(
		`  edges: ${edges.length} (~${Math.round(totalMeters)}m of path total)`
	)
	console.log(
		`  zones: ${zones.length} (${zones.map((z) => z.name).join(', ')})`
	)
}

// Only run when invoked directly (`node fetch_osm_paths.js`), not on import
// — lets the test suite import buildGraph/buildZonesFromLandmarks etc.
// without triggering a network call or a file write.
if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
	main()
}

export {
	buildGraph,
	dropTinyComponents,
	buildZonesFromLandmarks,
	buildFallbackZones,
	overpassElementsToSources,
	geojsonToSources,
	pointInAnyPolygon,
}
