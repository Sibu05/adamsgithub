import { jest } from '@jest/globals'

function setupDom() {
	document.body.innerHTML = `
		<nav>
			<button class="tab-btn tab-active" data-tab="events">Events</button>
			<button class="tab-btn" data-tab="placement">Placement</button>
		</nav>
		<div id="tab-events"></div>
		<div id="tab-placement" class="hidden">
			<div id="placement-map"></div>
			<p id="placement-live-count">— / —</p>
			<div id="placement-config-list"></div>
			<ul id="placement-events-list"></ul>
			<table><tbody id="placement-runs-body"></tbody></table>
			<button id="btn-placement-generate">Generate now</button>
			<button id="btn-placement-rotate">Rotate now</button>
			<p id="placement-action-msg" class="hidden"></p>
			<p id="placement-question-warning" class="hidden"></p>
		</div>
		<div id="toast"></div>
	`
}

// Minimal MapLibre stand-in — just enough surface area for
// placement-console.js's map code to run without throwing, and for
// tests to assert on what it was asked to draw.
class FakeSource {
	constructor() {
		this.setData = jest.fn()
	}
}
class FakeMap {
	constructor(opts) {
		this.opts = opts
		this.sources = {}
		this.layers = []
		this._handlers = {}
		this.addControl = jest.fn()
		this.setPaintProperty = jest.fn()
		this.resize = jest.fn()
		FakeMap.instances.push(this)
	}
	on(event, cb) {
		this._handlers[event] = cb
	}
	triggerLoad() {
		this._handlers.load?.()
	}
	addSource(id) {
		this.sources[id] = new FakeSource()
	}
	getSource(id) {
		return this.sources[id]
	}
	addLayer(layer) {
		this.layers.push(layer)
	}
}
FakeMap.instances = []
class FakeMarker {
	constructor({ element }) {
		this.element = element
		this.remove = jest.fn()
	}
	setLngLat() {
		return this
	}
	addTo() {
		return this
	}
	getElement() {
		return this.element
	}
}

function statusFixture(overrides = {}) {
	return {
		config: {
			minSpacingMeters: 80,
			maxLive: 12,
			eventTtlMinutes: 120,
			rotationIntervalMinutes: 15,
			radiusMeters: 30,
			cooldownRotations: 3,
		},
		activeEvents: [
			{
				event_id: 1,
				title: 'Pop-up Quest: West Campus',
				latitude: -26.19,
				longitude: 28.02,
				zone: 'west_campus',
				starts_at: '2026-01-01 00:00:00',
				ends_at: '2026-01-01 02:00:00',
			},
		],
		graph: {
			nodes: [
				{ id: 'n1', lat: -26.19, lng: 28.02 },
				{ id: 'n2', lat: -26.191, lng: 28.021 },
			],
			edges: [['n1', 'n2']],
		},
		zones: [
			{
				id: 'west_campus',
				name: 'West Campus',
				bounds: {
					west: 28.017,
					east: 28.026,
					south: -26.198,
					north: -26.173,
				},
				lastUsed: Date.now(),
			},
		],
		recentRuns: [
			{
				run_id: 1,
				started_at: '2026-01-01 00:00:00',
				status: 'SUCCESS',
				retired_count: 0,
				created_count: 1,
			},
		],
		...overrides,
	}
}

let placementConsole

beforeEach(async () => {
	jest.resetModules()
	setupDom()
	FakeMap.instances = []

	global.maplibregl = {
		Map: FakeMap,
		Marker: FakeMarker,
		NavigationControl: class {},
	}
	global.requestAnimationFrame = (cb) => cb()
	global.fetch = jest.fn()

	placementConsole = await import('./placement-console.js')
})

afterEach(() => {
	delete global.maplibregl
	delete global.fetch
	jest.restoreAllMocks()
})

describe('API dates (Recent runs "Started" column)', () => {
	// The real API sends ISO strings with a Z (mysql2 returns Date
	// objects); the old parser appended another Z → Invalid Date.
	const ISO = '2026-09-27T11:13:00.000Z'

	test('parseApiDate accepts ISO (with zone), SQL strings (UTC) and Dates', () => {
		const expected = Date.parse(ISO)
		expect(placementConsole.parseApiDate(ISO).getTime()).toBe(
			expected
		)
		expect(
			placementConsole
				.parseApiDate('2026-09-27 11:13:00')
				.getTime()
		).toBe(expected)
		expect(
			placementConsole
				.parseApiDate('2026-09-27T13:13:00+02:00')
				.getTime()
		).toBe(expected)
		expect(
			placementConsole.parseApiDate(new Date(ISO)).getTime()
		).toBe(expected)
	})

	test('parseApiDate returns null for empty or junk', () => {
		expect(placementConsole.parseApiDate(null)).toBeNull()
		expect(placementConsole.parseApiDate('')).toBeNull()
		expect(placementConsole.parseApiDate('not a date')).toBeNull()
	})

	test('renderRuns never prints "Invalid Date" for the real API shape', () => {
		placementConsole.renderRuns([
			{
				run_id: 7,
				started_at: ISO,
				status: 'SUCCESS',
				retired_count: 12,
				created_count: 12,
			},
		])
		const html = document.getElementById(
			'placement-runs-body'
		).innerHTML
		expect(html).not.toMatch(/Invalid Date/)
		expect(html).toContain('2026')
	})

	test('formatRunStarted shows — for a missing date', () => {
		expect(placementConsole.formatRunStarted(null)).toBe('—')
	})
})

describe('Wits question pool on the Placement tab', () => {
	const warning = () =>
		document.getElementById('placement-question-warning')

	test('shows the shortage message on the tab when there are too few', () => {
		placementConsole.renderQuestionPool({
			witsQuestions: 1,
			perPopup: 2,
			enough: false,
			message: 'Only 1 Wits-campus question available — each pop-up needs 2.',
		})
		expect(warning().classList.contains('hidden')).toBe(false)
		expect(warning().textContent).toMatch(
			/Only 1 Wits-campus question/
		)
	})

	test('hidden when there are enough', () => {
		placementConsole.renderQuestionPool({
			witsQuestions: 24,
			perPopup: 2,
			enough: true,
			message: null,
		})
		expect(warning().classList.contains('hidden')).toBe(true)
	})

	test('config panel lists the Wits question count', () => {
		placementConsole.renderConfig(
			{
				minSpacingMeters: 80,
				maxLive: 12,
				eventTtlMinutes: 60,
				rotationIntervalMinutes: 15,
				radiusMeters: 30,
				cooldownRotations: 3,
			},
			{ witsQuestions: 24, perPopup: 2, enough: true }
		)
		expect(
			document.getElementById('placement-config-list')
				.textContent
		).toMatch(/Wits questions\s*24 \(2 per pop-up\)/)
	})

	test('a SKIPPED run shows its reason in Recent runs', () => {
		placementConsole.renderRuns([
			{
				run_id: 9,
				started_at: '2026-09-27T11:13:00.000Z',
				status: 'SKIPPED',
				error: 'Only 0 Wits-campus questions available',
				retired_count: 0,
				created_count: 0,
			},
		])
		expect(
			document.querySelector('.placement-run-error')
				.textContent
		).toBe('Only 0 Wits-campus questions available')
	})
})

describe('formatTimeLeft', () => {
	test('works with the ISO strings the API really sends (was always "—")', () => {
		const now = new Date('2026-09-27T11:00:00.000Z')
		expect(
			placementConsole.formatTimeLeft(
				'2026-09-27T11:37:00.000Z',
				now
			)
		).toBe('37m left')
		expect(
			placementConsole.formatTimeLeft(
				'2026-09-27T12:04:00.000Z',
				now
			)
		).toBe('1h 4m left')
	})

	test('Active events rows show time left for the real API shape', () => {
		placementConsole.renderEventsList(
			[
				{
					title: 'Pop-up Quest: Great Hall',
					zone: 'great_hall',
					ends_at: '2026-09-27T11:45:00.000Z',
				},
			],
			new Date('2026-09-27T11:00:00.000Z')
		)
		expect(
			document.querySelector('.placement-event-time')
				.textContent
		).toBe('45m left')
	})

	test('formats minutes left', () => {
		const now = new Date('2026-01-01T00:00:00Z')
		expect(
			placementConsole.formatTimeLeft(
				'2026-01-01 00:37:00',
				now
			)
		).toBe('37m left')
	})

	test('formats hours + minutes left', () => {
		const now = new Date('2026-01-01T00:00:00Z')
		expect(
			placementConsole.formatTimeLeft(
				'2026-01-01 01:04:00',
				now
			)
		).toBe('1h 4m left')
	})

	test('past end time reads as Expiring', () => {
		const now = new Date('2026-01-01T01:00:00Z')
		expect(
			placementConsole.formatTimeLeft(
				'2026-01-01 00:00:00',
				now
			)
		).toBe('Expiring')
	})

	test('missing value is an em dash', () => {
		expect(placementConsole.formatTimeLeft(null)).toBe('—')
	})
})

describe('zoneAgeColor', () => {
	test('never-used zone is the coolest colour', () => {
		expect(placementConsole.zoneAgeColor(null)).toBe(
			'rgb(47,157,240)'
		)
	})

	test('just-used zone is warm, long-ago zone is cool', () => {
		const now = Date.now()
		const warm = placementConsole.zoneAgeColor(now, now)
		const cool = placementConsole.zoneAgeColor(
			now - 6 * 60 * 60 * 1000,
			now
		)
		expect(warm).toBe('rgb(240,90,60)')
		expect(cool).toBe('rgb(47,157,240)')
	})
})

describe('side panel rendering from /status', () => {
	test('renders live count, config, events list and runs table', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => statusFixture(),
		})

		await placementConsole.loadPlacementStatus()

		expect(
			document.getElementById('placement-live-count')
				.textContent
		).toBe('1 / 12')
		expect(
			document.getElementById('placement-config-list')
				.innerHTML
		).toContain('80 m')
		expect(
			document.getElementById('placement-events-list')
				.innerHTML
		).toContain('Pop-up Quest: West Campus')
		expect(
			document.getElementById('placement-runs-body').innerHTML
		).toContain('#1')
	})

	test('empty active events shows a friendly message', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => statusFixture({ activeEvents: [] }),
		})

		await placementConsole.loadPlacementStatus()

		expect(
			document.getElementById('placement-events-list')
				.textContent
		).toMatch(/No live pop-ups/)
	})

	test('a failed fetch surfaces an error toast and rethrows', async () => {
		global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })

		await expect(
			placementConsole.loadPlacementStatus()
		).rejects.toThrow()
	})
})

describe('map rendering', () => {
	test('clicking the Placement tab creates the map, unhides the panel, and fetches status', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => statusFixture(),
		})

		document.querySelector('[data-tab="placement"]').dispatchEvent(
			new Event('click', { bubbles: true })
		)
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(
			document.getElementById('tab-placement').classList
		).not.toContain('hidden')
		expect(FakeMap.instances).toHaveLength(1)
		expect(FakeMap.instances[0].opts.container).toBe(
			'placement-map'
		)
		expect(
			FakeMap.instances[0].opts.attributionControl
				.customAttribution
		).toBe('© OpenStreetMap contributors')
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/placement/status'),
			expect.any(Object)
		)
	})

	test('clicking a different tab hides the placement panel again', async () => {
		global.fetch.mockResolvedValue({
			ok: true,
			json: async () => statusFixture(),
		})
		document.querySelector('[data-tab="placement"]').dispatchEvent(
			new Event('click', { bubbles: true })
		)
		await new Promise((r) => setTimeout(r, 0))

		document.querySelector('[data-tab="events"]').dispatchEvent(
			new Event('click', { bubbles: true })
		)

		expect(
			document.getElementById('tab-placement').classList
		).toContain('hidden')
	})

	test('once the map "load"s, the graph, zones and circles are drawn from /status data', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => statusFixture(),
		})

		document.querySelector('[data-tab="placement"]').dispatchEvent(
			new Event('click', { bubbles: true })
		)
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		const map = FakeMap.instances[0]
		map.triggerLoad() // simulates MapLibre's 'load' event firing

		const layerIds = map.layers.map((l) => l.id)
		expect(layerIds).toEqual(
			expect.arrayContaining([
				'placement-graph-lines',
				'placement-zones-fill',
				'placement-zones-outline',
				'placement-zones-label',
				'placement-circles-fill',
				'placement-circles-line',
			])
		)

		// Graph: the fixture's single edge n1->n2 becomes one LineString.
		const graphData =
			map.getSource('placement-graph').setData.mock
				.calls[0][0]
		expect(graphData.features).toHaveLength(1)
		expect(graphData.features[0].geometry.type).toBe('LineString')
		expect(graphData.features[0].geometry.coordinates).toEqual([
			[28.02, -26.19],
			[28.021, -26.191],
		])

		// Zones: one zone with bounds becomes one Polygon, carrying a colour.
		const zoneData =
			map.getSource('placement-zones').setData.mock
				.calls[0][0]
		expect(zoneData.features).toHaveLength(1)
		expect(zoneData.features[0].properties.name).toBe('West Campus')
		expect(zoneData.features[0].properties.color).toMatch(/^rgb\(/)

		// Circles: fade-out/fade-in via setPaintProperty, then setData —
		// wait out the 260ms fade before asserting the swapped-in data.
		await new Promise((r) => setTimeout(r, 320))
		expect(map.setPaintProperty).toHaveBeenCalledWith(
			'placement-circles-fill',
			'fill-opacity',
			0
		)
		const circleData =
			map.getSource('placement-circles').setData.mock
				.calls[0][0]
		expect(circleData.features).toHaveLength(1)
		expect(circleData.features[0].geometry.type).toBe('Polygon')
	})
})

describe('describePlacementResult', () => {
	const cfg = { maxLive: 12, minSpacingMeters: 80 }
	const d = (...a) => placementConsole.describePlacementResult(...a)

	test('forced rotation: says how many were retired and placed', () => {
		expect(
			d(
				{
					retiredCount: 12,
					createdCount: 12,
					status: 'SUCCESS',
					forced: true,
					maxLive: 12,
				},
				'rotate',
				cfg
			)
		).toBe(
			'Rotated: retired 12 live pop-ups and placed 12 new ones.'
		)
	})

	test('explains a short batch (spacing / cooldown)', () => {
		expect(
			d(
				{
					retiredCount: 12,
					createdCount: 9,
					status: 'SUCCESS',
					maxLive: 12,
				},
				'rotate',
				cfg
			)
		).toMatch(
			/Only 9 of 12 fit — new pop-ups must stay 80 m apart.*cooldown/
		)
	})

	test('generate at the cap points to Rotate now', () => {
		expect(
			d(
				{ createdCount: 0, status: 'SUCCESS' },
				'generate',
				cfg
			)
		).toMatch(/already at the cap \(12 live\).*Rotate now/)
		expect(
			d(
				{ createdCount: 3, status: 'SUCCESS' },
				'generate',
				cfg
			)
		).toBe('Generated 3 new pop-ups.')
	})

	test('lock held, skipped and failed runs are reported as such', () => {
		expect(d({ skipped: true }, 'rotate', cfg)).toMatch(
			/already running/
		)
		expect(
			d(
				{ status: 'SKIPPED', error: 'No author' },
				'rotate',
				cfg
			)
		).toBe('No author')
		expect(
			d({ status: 'FAILED', error: 'boom' }, 'rotate', cfg)
		).toBe('Rotation failed: boom')
	})
})

describe('Generate now / Rotate now buttons', () => {
	test('Generate now POSTs to /api/placement/generate then refreshes status', async () => {
		global.fetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					createdCount: 2,
					status: 'SUCCESS',
					error: null,
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => statusFixture(),
			})

		const btn = document.getElementById('btn-placement-generate')
		btn.click()
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('/api/placement/generate'),
			expect.objectContaining({ method: 'POST' })
		)
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('/api/placement/status'),
			expect.any(Object)
		)
		expect(btn.disabled).toBe(false)
		expect(
			document.getElementById('placement-action-msg')
				.textContent
		).toMatch(/Generated/)
	})

	test('Rotate now POSTs to /api/placement/rotate', async () => {
		global.fetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					retiredCount: 1,
					createdCount: 1,
					status: 'SUCCESS',
					error: null,
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => statusFixture(),
			})

		const btn = document.getElementById('btn-placement-rotate')
		btn.click()
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('/api/placement/rotate'),
			expect.objectContaining({ method: 'POST' })
		)
		expect(
			document.getElementById('placement-action-msg')
				.textContent
		).toMatch(/Rotated: retired 1 live pop-up and placed 1 new one/)
	})

	test('buttons are disabled for the duration of the request', async () => {
		let resolveFetch
		global.fetch.mockReturnValueOnce(
			new Promise((r) => {
				resolveFetch = r
			})
		)

		const genBtn = document.getElementById('btn-placement-generate')
		const rotateBtn = document.getElementById(
			'btn-placement-rotate'
		)
		genBtn.click()
		await new Promise((r) => setTimeout(r, 0))

		expect(genBtn.disabled).toBe(true)
		expect(rotateBtn.disabled).toBe(true)

		resolveFetch({
			ok: true,
			json: async () => ({
				createdCount: 0,
				status: 'SUCCESS',
				error: null,
			}),
		})
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => statusFixture(),
		})
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(genBtn.disabled).toBe(false)
		expect(rotateBtn.disabled).toBe(false)
	})

	test('a failed action shows an error message and re-enables the button', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			json: async () => ({ error: 'boom' }),
		})

		const btn = document.getElementById('btn-placement-generate')
		btn.click()
		await new Promise((r) => setTimeout(r, 0))
		await new Promise((r) => setTimeout(r, 0))

		expect(btn.disabled).toBe(false)
		expect(
			document.getElementById('placement-action-msg')
				.textContent
		).toMatch(/Failed/)
	})
})
