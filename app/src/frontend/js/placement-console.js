// placement-console.js — "Procedural Placement" tab (console). Kept out
// of console.js (already ~70KB) and fully self-contained: it manages its
// own tab visibility (console.js doesn't know this tab exists) and talks
// only to /api/placement/*.
import { API_BASE } from './constants.js'
import { showToast, esc, formatDT } from './utils.js'
import {
	createCampusStyle,
	CAMPUS_CAMERA,
	CAMPUS_MAX_ZOOM,
} from './campus-style.js'

const PLACEMENT_API = `${API_BASE}/api/placement`

// Visual-only window for the zone "time since last event" colour scale —
// zones older than this all read as equally "cool". Not tied to any
// config value; just wide enough to show a gradient across a demo.
const ZONE_COLOR_WINDOW_MS = 3 * 60 * 60 * 1000 // 3 hours

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Placement map camera: whole-campus overview (see ensureMap).
const OVERVIEW_ZOOM = 15.5
const OVERVIEW_MIN_ZOOM = 13

// ── DOM refs ──────────────────────────────────────────────────
const tabButtons = document.querySelectorAll('.tab-btn')
const tabPlacement = document.getElementById('tab-placement')
const elMapContainer = document.getElementById('placement-map')
const elLiveCount = document.getElementById('placement-live-count')
const elConfigList = document.getElementById('placement-config-list')
const elEventsList = document.getElementById('placement-events-list')
const elRunsBody = document.getElementById('placement-runs-body')
const elActionMsg = document.getElementById('placement-action-msg')
const elQuestionWarning = document.getElementById('placement-question-warning')
const btnGenerate = document.getElementById('btn-placement-generate')
const btnRotate = document.getElementById('btn-placement-rotate')

// ── Map state (lazy — only touched once the tab is first shown) ──
let map = null
let mapReady = false
let graphRendered = false
let currentMarkers = []
let hasLoadedOnce = false

// ── Pure helpers (exported for tests) ────────────────────────────

/**
 * DATETIME from the API as a Date. The API sends ISO strings with a zone
 * ("2026-09-27T11:13:00.000Z") because mysql2 returns Date objects; bare
 * SQL strings ("2026-09-27 11:13:00") are UTC too. Appending 'Z' to an
 * ISO string (the old approach) gave "…ZZ" → Invalid Date.
 * Returns null for empty/unparseable input.
 */
export function parseApiDate(value) {
	if (value == null || value === '') return null
	if (value instanceof Date) return isNaN(value) ? null : value
	const s = String(value).trim()
	const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
	const d = new Date(hasZone ? s : s.replace(' ', 'T') + 'Z')
	return isNaN(d) ? null : d
}

/** Started-column text for a placement run, e.g. "27 Sept 2026, 13:13". */
export function formatRunStarted(value) {
	const d = parseApiDate(value)
	return d ? formatDT(d.toISOString()) : '—'
}

/** "37m left" / "1h 4m left" / "Expiring" / "—" for an ISO/SQL datetime. */
export function formatTimeLeft(endsAt, now = new Date()) {
	// parseApiDate: the API sends ISO strings ("...Z"); the old
	// replace(' ', 'T') + 'Z' turned them into "...ZZ" → always "—".
	const end = parseApiDate(endsAt)
	if (!end) return '—'
	const diffMs = end.getTime() - now.getTime()
	if (diffMs <= 0) return 'Expiring'
	const mins = Math.round(diffMs / 60000)
	if (mins < 60) return `${mins}m left`
	return `${Math.floor(mins / 60)}h ${mins % 60}m left`
}

/**
 * Cool (long ago / never used) → warm (just used) colour for a zone.
 * `lastUsed` is a ms-epoch timestamp or null/undefined.
 */
export function zoneAgeColor(
	lastUsed,
	now = Date.now(),
	windowMs = ZONE_COLOR_WINDOW_MS
) {
	if (lastUsed == null) return 'rgb(47,157,240)' // coolest — never used
	const age = Math.max(0, now - lastUsed)
	const warmth = 1 - Math.min(1, age / windowMs) // 1 = just used, 0 = old
	const r = Math.round(47 + (240 - 47) * warmth)
	const g = Math.round(157 + (90 - 157) * warmth)
	const b = Math.round(240 + (60 - 240) * warmth)
	return `rgb(${r},${g},${b})`
}

// Same technique as events.js's renderProximityCircles — a small regular
// polygon approximating a circle of `radiusMeters` around [lng, lat].
function circleCoords(lng, lat, radiusMeters, steps = 48) {
	const pts = []
	const kx = 111320 * Math.cos((lat * Math.PI) / 180)
	for (let i = 0; i <= steps; i++) {
		const a = (i / steps) * Math.PI * 2
		pts.push([
			lng + (Math.cos(a) * radiusMeters) / kx,
			lat + (Math.sin(a) * radiusMeters) / 110540,
		])
	}
	return pts
}

function zonePolygon(bounds) {
	const { west, east, south, north } = bounds
	return [
		[
			[west, south],
			[east, south],
			[east, north],
			[west, north],
			[west, south],
		],
	]
}

function badgeForStatus(status) {
	const cls =
		status === 'SUCCESS'
			? 'active'
			: status === 'SKIPPED'
				? ''
				: 'inactive'
	return `<span class="meta-pill ${cls}">${esc(status)}</span>`
}

/**
 * Plain-English result of a Generate / Rotate now click.
 * `kind` is 'generate' or 'rotate'; `config` is the placement config
 * (for maxLive / spacing when explaining a short batch).
 */
export function describePlacementResult(data, kind, config = {}) {
	if (data?.skipped)
		return 'Another rotation is already running — try again in a moment.'
	if (data?.status === 'FAILED')
		return `Rotation failed: ${data.error || 'unknown error'}`
	if (data?.status === 'SKIPPED')
		return data.error || 'Skipped — no pop-ups were created.'

	const created = data?.createdCount ?? 0
	const retired = data?.retiredCount ?? 0
	const cap = data?.maxLive ?? config.maxLive
	const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
	const shortNote =
		cap != null && created < cap
			? ` Only ${created} of ${cap} fit — new pop-ups must stay ${config.minSpacingMeters ?? 80} m apart on walkable paths and away from the last few batches (cooldown).`
			: ''

	if (kind === 'rotate')
		return (
			`Rotated: retired ${plural(retired, 'live pop-up')} and placed ${plural(created, 'new one')}.` +
			shortNote
		)
	if (created === 0)
		return `Nothing to add — already at the cap (${cap ?? '?'} live). Use Rotate now to replace them.`
	return `Generated ${plural(created, 'new pop-up')}.`
}

/**
 * [[west, south], [east, north]] around every live pop-up, or around the
 * whole path graph when there are none (never an empty/blank view).
 * Returns null if there's nothing to fit.
 */
export function placementBounds(activeEvents = [], graph = null) {
	let pts = activeEvents
		.map((ev) => [Number(ev.longitude), Number(ev.latitude)])
		.filter(
			([lng, lat]) =>
				Number.isFinite(lng) && Number.isFinite(lat)
		)
	if (!pts.length && graph?.nodes?.length)
		pts = graph.nodes.map((n) => [n.lng, n.lat])
	if (!pts.length) return null
	const lngs = pts.map((p) => p[0])
	const lats = pts.map((p) => p[1])
	return [
		[Math.min(...lngs), Math.min(...lats)],
		[Math.max(...lngs), Math.max(...lats)],
	]
}

// ── Side panel rendering (pure DOM writes — no map involved) ────

export function renderLiveCount(activeEvents, config) {
	if (!elLiveCount) return
	elLiveCount.textContent = `${activeEvents.length} / ${config?.maxLive ?? '—'}`
}

/**
 * Warn on the tab itself when there aren't enough Wits-campus questions
 * for a pop-up (the run would be SKIPPED) — not only in the server log.
 */
export function renderQuestionPool(pool) {
	if (!elQuestionWarning) return
	if (!pool || pool.enough) {
		elQuestionWarning.classList.add('hidden')
		elQuestionWarning.textContent = ''
		return
	}
	elQuestionWarning.textContent = `⚠ ${pool.message}`
	elQuestionWarning.classList.remove('hidden')
}

export function renderConfig(config, pool = null) {
	if (!elConfigList || !config) return
	const rows = [
		['Min spacing', `${config.minSpacingMeters} m`],
		['Max live', config.maxLive],
		['Event TTL', `${config.eventTtlMinutes} min`],
		['Rotation interval', `${config.rotationIntervalMinutes} min`],
		['Radius', `${config.radiusMeters} m`],
		['Cooldown rotations', config.cooldownRotations],
		...(pool
			? [
					[
						'Wits questions',
						`${pool.witsQuestions} (${pool.perPopup} per pop-up)`,
					],
				]
			: []),
	]
	elConfigList.innerHTML = rows
		.map(
			([k, v]) =>
				`<div class="placement-config-row"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`
		)
		.join('')
}

export function renderEventsList(activeEvents, now = new Date()) {
	if (!elEventsList) return
	if (!activeEvents.length) {
		elEventsList.innerHTML =
			'<li class="state-msg" style="padding:1rem 0">No live pop-ups right now.</li>'
		return
	}
	elEventsList.innerHTML = activeEvents
		.map(
			(ev) => `<li class="placement-event-row">
				<span class="placement-event-title">${esc(ev.title)}</span>
				<span class="meta-pill">${esc(ev.zone ?? 'unzoned')}</span>
				<span class="placement-event-time">${esc(formatTimeLeft(ev.ends_at, now))}</span>
			</li>`
		)
		.join('')
}

export function renderRuns(runs) {
	if (!elRunsBody) return
	if (!runs?.length) {
		elRunsBody.innerHTML =
			'<tr><td colspan="5" class="state-msg" style="padding:1rem 0">No runs yet.</td></tr>'
		return
	}
	elRunsBody.innerHTML = runs
		.map(
			(r) => `<tr>
				<td style="padding:0.3rem 0">#${r.run_id}</td>
				<td style="padding:0.3rem 0">${esc(formatRunStarted(r.started_at))}</td>
				<td style="padding:0.3rem 0" title="${esc(r.error ?? '')}">${badgeForStatus(r.status)}${
					r.status !== 'SUCCESS' && r.error
						? `<span class="placement-run-error">${esc(r.error)}</span>`
						: ''
				}</td>
				<td style="padding:0.3rem 0;text-align:right">${r.retired_count}</td>
				<td style="padding:0.3rem 0;text-align:right">${r.created_count}</td>
			</tr>`
		)
		.join('')
}

function renderSidePanel(status) {
	renderLiveCount(status.activeEvents, status.config)
	renderConfig(status.config, status.questionPool)
	renderQuestionPool(status.questionPool)
	renderEventsList(status.activeEvents)
	renderRuns(status.recentRuns)
}

// ── Map ───────────────────────────────────────────────────────

function ensureMap() {
	if (map || !elMapContainer || typeof maplibregl === 'undefined') {
		return map
	}
	map = new maplibregl.Map({
		container: 'placement-map',
		style: createCampusStyle(),
		center: CAMPUS_CAMERA.center,
		zoom: OVERVIEW_ZOOM,
		pitch: 0,
		bearing: 0,
		// An author's top-down overview, not the player's street-level
		// camera: the player limits (minZoom 17, minPitch 55) clamped
		// this map too, so it could never zoom out to frame all pop-ups
		// (~zoom 15) and was always tilted.
		minZoom: OVERVIEW_MIN_ZOOM,
		maxZoom: CAMPUS_MAX_ZOOM,
		minPitch: 0,
		maxPitch: 60,
		// The base tiles are CartoDB-hosted but OSM-derived, and — once
		// fetch_osm_paths.js has been run — the path graph, zones and
		// walkway data drawn on top are OSM data directly. Set explicitly
		// rather than relying on the vector tile source's own TileJSON to
		// carry attribution.
		attributionControl: {
			compact: true,
			customAttribution: '© OpenStreetMap contributors',
		},
	})
	map.addControl(
		new maplibregl.NavigationControl({ visualizePitch: false }),
		'bottom-right'
	)
	map.on('load', () => {
		mapReady = true

		map.addSource('placement-graph', {
			type: 'geojson',
			data: EMPTY_FC,
		})
		map.addLayer({
			id: 'placement-graph-lines',
			type: 'line',
			source: 'placement-graph',
			paint: {
				'line-color': '#8fa6bd',
				'line-width': 2,
				'line-opacity': 0.55,
			},
		})

		map.addSource('placement-zones', {
			type: 'geojson',
			data: EMPTY_FC,
		})
		map.addLayer({
			id: 'placement-zones-fill',
			type: 'fill',
			source: 'placement-zones',
			paint: {
				'fill-color': ['get', 'color'],
				'fill-opacity-transition': { duration: 280 },
				'fill-opacity': 0.28,
			},
		})
		map.addLayer({
			id: 'placement-zones-outline',
			type: 'line',
			source: 'placement-zones',
			paint: {
				'line-color': ['get', 'color'],
				'line-width': 1.5,
			},
		})
		map.addLayer({
			id: 'placement-zones-label',
			type: 'symbol',
			source: 'placement-zones',
			layout: {
				'text-field': ['get', 'name'],
				'text-size': 12,
				'text-font': ['Noto Sans Regular'],
			},
			paint: {
				'text-color': '#e6eef6',
				'text-halo-color': '#0a1622',
				'text-halo-width': 1.2,
			},
		})

		map.addSource('placement-circles', {
			type: 'geojson',
			data: EMPTY_FC,
		})
		map.addLayer({
			id: 'placement-circles-fill',
			type: 'fill',
			source: 'placement-circles',
			paint: {
				'fill-color': '#2f9df0',
				'fill-opacity-transition': { duration: 280 },
				'fill-opacity': 0.14,
			},
		})
		map.addLayer({
			id: 'placement-circles-line',
			type: 'line',
			source: 'placement-circles',
			paint: {
				'line-color': '#2f9df0',
				'line-width': 1.5,
				'line-opacity': 0.5,
				'line-dasharray': [4, 3],
			},
		})

		if (latestStatus) renderMapData(latestStatus)
	})
	return map
}

function renderGraphOnce(graph) {
	if (graphRendered || !graph || !mapReady) return
	graphRendered = true
	const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
	const features = graph.edges
		.map(([fromId, toId]) => {
			const from = nodeById.get(fromId)
			const to = nodeById.get(toId)
			if (!from || !to) return null
			return {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[from.lng, from.lat],
						[to.lng, to.lat],
					],
				},
			}
		})
		.filter(Boolean)
	map.getSource('placement-graph')?.setData({
		type: 'FeatureCollection',
		features,
	})
}

function renderZones(zones) {
	if (!mapReady || !zones) return
	const now = Date.now()
	const features = zones
		.filter((z) => z.bounds)
		.map((z) => ({
			type: 'Feature',
			properties: {
				name: z.name,
				color: zoneAgeColor(z.lastUsed, now),
			},
			geometry: {
				type: 'Polygon',
				coordinates: zonePolygon(z.bounds),
			},
		}))
	map.getSource('placement-zones')?.setData({
		type: 'FeatureCollection',
		features,
	})
}

// Fades the circle layer out, swaps the data, fades it back in — the
// closest a GeoJSON source update gets to an animated transition, since
// MapLibre doesn't tween geometry changes on its own.
function renderCirclesAnimated(activeEvents, radiusMeters) {
	if (!mapReady) return
	const features = activeEvents
		.map((ev) => {
			const lng = Number(ev.longitude)
			const lat = Number(ev.latitude)
			if (isNaN(lng) || isNaN(lat)) return null
			return {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						circleCoords(
							lng,
							lat,
							radiusMeters
						),
					],
				},
			}
		})
		.filter(Boolean)

	map.setPaintProperty('placement-circles-fill', 'fill-opacity', 0)
	setTimeout(() => {
		map.getSource('placement-circles')?.setData({
			type: 'FeatureCollection',
			features,
		})
		map.setPaintProperty(
			'placement-circles-fill',
			'fill-opacity',
			0.14
		)
	}, 260)
}

// Old marker dots fade+drop out, new ones fade+drop in — see the CSS
// classes in placement-console.css for the actual transition.
function renderEventMarkers(activeEvents) {
	if (!mapReady) return
	const outgoing = currentMarkers
	currentMarkers = []

	activeEvents.forEach((ev) => {
		const lng = Number(ev.longitude)
		const lat = Number(ev.latitude)
		if (isNaN(lng) || isNaN(lat)) return

		// MapLibre positions the marker's root element itself, so the
		// animated dot is a child element instead.
		const root = document.createElement('div')
		const dot = document.createElement('div')
		dot.className = 'placement-marker-dot placement-marker-enter'
		root.appendChild(dot)
		root.title = ev.title

		const marker = new maplibregl.Marker({ element: root })
			.setLngLat([lng, lat])
			.addTo(map)
		currentMarkers.push(marker)

		requestAnimationFrame(() =>
			dot.classList.remove('placement-marker-enter')
		)
	})

	outgoing.forEach((marker) => {
		const dot = marker.getElement()?.firstChild
		dot?.classList.add('placement-marker-leave')
		setTimeout(() => marker.remove(), 300)
	})
}

// Frame every live pop-up (or the whole graph if there are none).
// Called when the tab opens and after each load (initial / after Generate
// or Rotate now), so the map never opens on an empty corner of campus.
function fitToPopups(status, { animate = true } = {}) {
	if (!mapReady || !status) return
	const bounds = placementBounds(status.activeEvents, status.graph)
	if (!bounds) return
	map.fitBounds(bounds, {
		padding: 48,
		maxZoom: 17.5,
		duration: animate ? 600 : 0,
	})
}

function renderMapData(status) {
	ensureMap()
	if (!mapReady) return // 'load' handler re-calls this once ready
	renderGraphOnce(status.graph)
	renderZones(status.zones)
	renderCirclesAnimated(
		status.activeEvents,
		(status.config?.minSpacingMeters ?? 80) / 2
	)
	renderEventMarkers(status.activeEvents)
	fitToPopups(status)
}

// ── Data loading ──────────────────────────────────────────────

let latestStatus = null

export async function loadPlacementStatus() {
	try {
		const res = await fetch(`${PLACEMENT_API}/status`, {
			credentials: 'include',
		})
		if (!res.ok) throw new Error(`Server ${res.status}`)
		const data = await res.json()
		latestStatus = data
		renderSidePanel(data)
		renderMapData(data)
		return data
	} catch (err) {
		showToast('Could not load placement status', 'error')
		throw err
	}
}

async function runAction(url, btn, busyLabel, kind) {
	if (!btn) return
	const otherBtn = btn === btnGenerate ? btnRotate : btnGenerate
	const originalLabel = btn.textContent
	btn.disabled = true
	if (otherBtn) otherBtn.disabled = true
	btn.textContent = busyLabel
	setActionMsg('', null)

	try {
		const res = await fetch(url, {
			method: 'POST',
			credentials: 'include',
		})
		const data = await res.json().catch(() => ({}))
		if (!res.ok)
			throw new Error(data.error || `Server ${res.status}`)

		const summary = describePlacementResult(
			data,
			kind,
			latestStatus?.config
		)
		const ok = !data.skipped && data.status !== 'FAILED'
		setActionMsg(summary, ok ? 'success' : 'error')
		showToast(summary, ok ? 'success' : 'error')

		await loadPlacementStatus()
	} catch (err) {
		setActionMsg(`Failed: ${err.message}`, 'error')
		showToast(`Placement action failed: ${err.message}`, 'error')
	} finally {
		btn.disabled = false
		if (otherBtn) otherBtn.disabled = false
		btn.textContent = originalLabel
	}
}

function setActionMsg(text, kind) {
	if (!elActionMsg) return
	if (!text) {
		elActionMsg.classList.add('hidden')
		elActionMsg.textContent = ''
		return
	}
	elActionMsg.textContent = text
	elActionMsg.classList.remove('hidden')
	elActionMsg.style.color =
		kind === 'error' ? 'var(--danger)' : 'var(--success)'
}

btnGenerate?.addEventListener('click', () =>
	runAction(
		`${PLACEMENT_API}/generate`,
		btnGenerate,
		'Generating…',
		'generate'
	)
)
btnRotate?.addEventListener('click', () =>
	runAction(`${PLACEMENT_API}/rotate`, btnRotate, 'Rotating…', 'rotate')
)

// ── Tab visibility (self-managed — console.js doesn't know this tab
// exists, so it never hides/shows it for us) ──────────────────────
tabButtons.forEach((btn) => {
	btn.addEventListener('click', () => {
		if (btn.dataset.tab === 'placement') {
			tabPlacement?.classList.remove('hidden')
			ensureMap()
			if (!hasLoadedOnce) {
				hasLoadedOnce = true
				loadPlacementStatus()
			} else if (mapReady) {
				// Map was created but MapLibre needs a resize nudge after
				// being shown from a display:none container.
				map.resize()
				fitToPopups(latestStatus, { animate: false })
			}
		} else {
			tabPlacement?.classList.add('hidden')
		}
	})
})
