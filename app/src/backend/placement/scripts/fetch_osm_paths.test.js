import {
	buildGraph,
	dropTinyComponents,
	buildZonesFromLandmarks,
	buildFallbackZones,
	overpassElementsToSources,
	geojsonToSources,
	pointInAnyPolygon,
} from './fetch_osm_paths.js'

describe('pointInAnyPolygon', () => {
	const box = [
		{ lat: -26.2, lng: 28.0 },
		{ lat: -26.2, lng: 28.1 },
		{ lat: -26.1, lng: 28.1 },
		{ lat: -26.1, lng: 28.0 },
	]

	test('no polygons means no filtering (always inside)', () => {
		expect(pointInAnyPolygon({ lat: 0, lng: 0 }, [])).toBe(true)
	})

	test('classifies a point inside the ring', () => {
		expect(
			pointInAnyPolygon({ lat: -26.15, lng: 28.05 }, [box])
		).toBe(true)
	})

	test('classifies a point outside the ring', () => {
		expect(
			pointInAnyPolygon({ lat: -25.0, lng: 28.05 }, [box])
		).toBe(false)
	})

	test('true if inside ANY of several polygons', () => {
		const other = [
			{ lat: 0, lng: 0 },
			{ lat: 0, lng: 1 },
			{ lat: 1, lng: 1 },
			{ lat: 1, lng: 0 },
		]
		expect(
			pointInAnyPolygon({ lat: -26.15, lng: 28.05 }, [
				other,
				box,
			])
		).toBe(true)
	})
})

describe('buildGraph', () => {
	test('merges nodes at shared coordinates across separate ways', () => {
		// Two lines sharing the endpoint [28.032, -26.191] should collapse
		// to one graph node there, not two.
		const lineA = [
			{ lat: -26.192, lng: 28.03 },
			{ lat: -26.191, lng: 28.032 },
		]
		const lineB = [
			{ lat: -26.191, lng: 28.032 },
			{ lat: -26.19, lng: 28.034 },
		]

		const { nodes, edges } = buildGraph([lineA, lineB], [])

		expect(nodes).toHaveLength(3)
		expect(edges).toHaveLength(2)
	})

	test('drops a component smaller than MIN_COMPONENT_SIZE', () => {
		const mainLine = [
			{ lat: -26.192, lng: 28.03 },
			{ lat: -26.191, lng: 28.032 },
			{ lat: -26.19, lng: 28.034 },
		]
		const isolatedStub = [
			{ lat: -26.3, lng: 28.09 },
			{ lat: -26.301, lng: 28.091 },
		]

		const { nodes, edges } = buildGraph(
			[mainLine, isolatedStub],
			[]
		)

		expect(nodes).toHaveLength(3)
		expect(edges).toHaveLength(2)
		expect(nodes.some((n) => n.lat === -26.3)).toBe(false)
	})

	test('trims a way to whichever points fall inside the boundary', () => {
		// 3 points inside (survives the MIN_COMPONENT_SIZE=3 floor on its
		// own) + 1 point way outside, which should be dropped.
		const line = [
			{ lat: -26.192, lng: 28.03 },
			{ lat: -26.191, lng: 28.032 },
			{ lat: -26.19, lng: 28.034 },
			{ lat: -25.0, lng: 30.0 }, // way outside
		]
		const boundary = [
			{ lat: -26.2, lng: 28.0 },
			{ lat: -26.2, lng: 28.1 },
			{ lat: -26.1, lng: 28.1 },
			{ lat: -26.1, lng: 28.0 },
		]

		const { nodes, edges } = buildGraph([line], [boundary])

		expect(nodes).toHaveLength(3)
		expect(edges).toHaveLength(2)
		expect(nodes.some((n) => n.lat === -25.0)).toBe(false)
	})

	test('never bridges the gap where a way leaves and re-enters the boundary', () => {
		const boundary = [
			{ lat: -26.2, lng: 28.0 },
			{ lat: -26.2, lng: 28.1 },
			{ lat: -26.1, lng: 28.1 },
			{ lat: -26.1, lng: 28.0 },
		]
		const line = [
			{ lat: -26.15, lng: 28.01 },
			{ lat: -26.15, lng: 28.02 },
			{ lat: -26.15, lng: 28.03 },
			{ lat: -25.0, lng: 28.05 }, // outside
			{ lat: -26.15, lng: 28.07 },
			{ lat: -26.15, lng: 28.08 },
			{ lat: -26.15, lng: 28.09 },
		]

		const { edges } = buildGraph([line], [boundary])

		// 2 edges per inside run, none joining 28.03 to 28.07.
		expect(edges).toHaveLength(4)
	})

	test('renumbers surviving nodes sequentially from n1', () => {
		const line = [
			{ lat: -26.192, lng: 28.03 },
			{ lat: -26.191, lng: 28.032 },
			{ lat: -26.19, lng: 28.034 },
		]
		const { nodes } = buildGraph([line], [])
		expect(nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
	})
})

describe('dropTinyComponents', () => {
	test('keeps components at or above the size threshold, drops smaller ones', () => {
		const nodes = [
			{ id: 'a', lat: 0, lng: 0 },
			{ id: 'b', lat: 0, lng: 1 },
			{ id: 'c', lat: 0, lng: 2 },
			{ id: 'x', lat: 5, lng: 5 },
			{ id: 'y', lat: 5, lng: 6 },
		]
		const edges = [
			['a', 'b'],
			['b', 'c'],
			['x', 'y'], // component of size 2 — below MIN_COMPONENT_SIZE (3)
		]

		const result = dropTinyComponents({ nodes, edges })

		expect(result.nodes).toHaveLength(3)
		expect(result.edges).toHaveLength(2)
	})
})

describe('buildZonesFromLandmarks', () => {
	test('matches known Wits landmark keywords, case-insensitively', () => {
		const named = [
			{ name: 'Great Hall', lat: -26.19, lng: 28.03 },
			{
				name: 'William Cullen Library',
				lat: -26.191,
				lng: 28.031,
			},
			{ name: 'the matrix', lat: -26.192, lng: 28.032 },
			{ name: 'Random Kiosk', lat: -26.193, lng: 28.033 }, // no match
		]
		const zones = buildZonesFromLandmarks(named)
		expect(zones.map((z) => z.name)).toEqual([
			'Great Hall',
			'William Cullen Library',
			'the matrix',
		])
		for (const z of zones) {
			expect(z.bounds.east).toBeGreaterThan(z.bounds.west)
			expect(z.bounds.north).toBeGreaterThan(z.bounds.south)
		}
	})

	test('caps at 6 zones and never returns duplicate names', () => {
		const named = [
			{ name: 'Great Hall', lat: -26.19, lng: 28.03 },
			{ name: 'Great Hall', lat: -26.19, lng: 28.03 }, // duplicate
			{ name: 'Library', lat: -26.191, lng: 28.031 },
			{ name: 'Matrix', lat: -26.192, lng: 28.032 },
			{ name: 'Senate House', lat: -26.193, lng: 28.033 },
			{
				name: 'Wartenweiler Library',
				lat: -26.194,
				lng: 28.034,
			},
			{ name: 'Science Stadium', lat: -26.195, lng: 28.035 },
			{ name: 'Origins Centre', lat: -26.196, lng: 28.036 },
		]
		const zones = buildZonesFromLandmarks(named)
		expect(zones.length).toBeLessThanOrEqual(6)
		expect(new Set(zones.map((z) => z.name)).size).toBe(
			zones.length
		)
	})

	test('no recognisable landmarks -> no zones', () => {
		expect(
			buildZonesFromLandmarks([{ name: 'Random Kiosk' }])
		).toEqual([])
	})
})

describe('buildFallbackZones', () => {
	test('produces 5 zones covering the nodes bounding box', () => {
		const nodes = [
			{ id: 'a', lat: -26.2, lng: 28.0 },
			{ id: 'b', lat: -26.1, lng: 28.1 },
		]
		const zones = buildFallbackZones(nodes)
		expect(zones).toHaveLength(5)
		for (const z of zones) {
			expect(z.bounds.west).toBeGreaterThanOrEqual(28.0)
			expect(z.bounds.east).toBeLessThanOrEqual(28.1)
			expect(z.bounds.south).toBeGreaterThanOrEqual(-26.2)
			expect(z.bounds.north).toBeLessThanOrEqual(-26.1)
		}
	})
})

describe('overpassElementsToSources', () => {
	test('separates footway ways, the campus boundary, and named landmarks', () => {
		const elements = [
			{ type: 'node', id: 1, lat: -26.192, lon: 28.03 },
			{ type: 'node', id: 2, lat: -26.191, lon: 28.032 },
			{
				type: 'way',
				id: 100,
				nodes: [1, 2],
				tags: { highway: 'footway' },
			},
			{
				type: 'way',
				id: 101,
				nodes: [1, 2],
				tags: { highway: 'motorway' }, // not a walkway — excluded
			},
			{ type: 'node', id: 10, lat: -26.2, lon: 28.0 },
			{ type: 'node', id: 11, lat: -26.2, lon: 28.1 },
			{ type: 'node', id: 12, lat: -26.1, lon: 28.1 },
			{ type: 'node', id: 13, lat: -26.1, lon: 28.0 },
			{
				type: 'way',
				id: 200,
				nodes: [10, 11, 12, 13],
				tags: {
					amenity: 'university',
					name: 'University of the Witwatersrand',
				},
			},
			{
				type: 'node',
				id: 4,
				lat: -26.1918,
				lon: 28.0305,
				tags: { building: 'yes', name: 'Great Hall' },
			},
		]

		const sources = overpassElementsToSources(elements)

		expect(sources.polylines).toHaveLength(1)
		expect(sources.polylines[0]).toHaveLength(2)
		expect(sources.boundaryPolygons).toHaveLength(1)
		expect(sources.namedFeatures).toEqual([
			{ name: 'Great Hall', lat: -26.1918, lng: 28.0305 },
		])
	})

	test('a real boundary correctly filters footway points via buildGraph', () => {
		const elements = [
			{ type: 'node', id: 1, lat: -26.192, lon: 28.03 },
			{ type: 'node', id: 2, lat: -26.191, lon: 28.032 },
			{ type: 'node', id: 3, lat: -26.19, lon: 28.034 },
			{ type: 'node', id: 4, lat: -25.0, lon: 30.0 }, // way outside
			{
				type: 'way',
				id: 100,
				nodes: [1, 2, 3, 4],
				tags: { highway: 'footway' },
			},
			{ type: 'node', id: 10, lat: -26.2, lon: 28.0 },
			{ type: 'node', id: 11, lat: -26.2, lon: 28.05 },
			{ type: 'node', id: 12, lat: -26.17, lon: 28.05 },
			{ type: 'node', id: 13, lat: -26.17, lon: 28.0 },
			{
				type: 'way',
				id: 200,
				nodes: [10, 11, 12, 13],
				tags: {
					amenity: 'university',
					name: 'University of the Witwatersrand',
				},
			},
		]
		const sources = overpassElementsToSources(elements)
		const { nodes, edges } = buildGraph(
			sources.polylines,
			sources.boundaryPolygons
		)
		expect(nodes).toHaveLength(3)
		expect(edges).toHaveLength(2)
		expect(nodes.some((n) => n.lat === -25.0)).toBe(false)
	})
})

describe('geojsonToSources', () => {
	test('LineString features become polylines (lon,lat -> lat,lng)', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						tags: { highway: 'footway' },
					},
					geometry: {
						type: 'LineString',
						coordinates: [
							[28.03, -26.192],
							[28.032, -26.191],
						],
					},
				},
			],
		}
		const sources = geojsonToSources(geojson)
		expect(sources.polylines).toEqual([
			[
				{ lat: -26.192, lng: 28.03 },
				{ lat: -26.191, lng: 28.032 },
			],
		])
	})

	test('a highway tag outside the allowed set is excluded', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						tags: { highway: 'motorway' },
					},
					geometry: {
						type: 'LineString',
						coordinates: [
							[28.03, -26.192],
							[28.032, -26.191],
						],
					},
				},
			],
		}
		expect(geojsonToSources(geojson).polylines).toHaveLength(0)
	})

	test('a LineString with no highway tag (fence, bus route...) is excluded', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { barrier: 'fence' },
					geometry: {
						type: 'LineString',
						coordinates: [
							[28.03, -26.192],
							[28.032, -26.191],
						],
					},
				},
			],
		}
		expect(geojsonToSources(geojson).polylines).toHaveLength(0)
	})

	test('campus-road highway types go to campusRoadPolylines, not polylines', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { highway: 'service' },
					geometry: {
						type: 'LineString',
						coordinates: [
							[28.03, -26.192],
							[28.032, -26.191],
						],
					},
				},
				{
					type: 'Feature',
					properties: {
						tags: {
							highway: 'residential',
						},
					},
					geometry: {
						type: 'LineString',
						coordinates: [
							[28.03, -26.192],
							[28.032, -26.191],
						],
					},
				},
			],
		}
		const sources = geojsonToSources(geojson)
		expect(sources.polylines).toHaveLength(0)
		expect(sources.campusRoadPolylines).toHaveLength(2)
	})

	test('a Polygon tagged as the Wits university boundary becomes a boundaryPolygon', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						tags: {
							amenity: 'university',
							name: 'University of the Witwatersrand',
						},
					},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[28.0, -26.2],
								[28.1, -26.2],
								[28.1, -26.1],
								[28.0, -26.1],
								[28.0, -26.2],
							],
						],
					},
				},
			],
		}
		const sources = geojsonToSources(geojson)
		expect(sources.boundaryPolygons).toHaveLength(1)
		expect(sources.boundaryPolygons[0]).toHaveLength(5)
	})

	test('a named building/amenity Point becomes a named feature', () => {
		const geojson = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						tags: {
							building: 'yes',
							name: 'Great Hall',
						},
					},
					geometry: {
						type: 'Point',
						coordinates: [
							28.0305, -26.1918,
						],
					},
				},
			],
		}
		const sources = geojsonToSources(geojson)
		expect(sources.namedFeatures).toEqual([
			{ name: 'Great Hall', lat: -26.1918, lng: 28.0305 },
		])
	})
})
