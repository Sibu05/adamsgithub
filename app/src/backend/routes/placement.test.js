import { jest } from '@jest/globals'

jest.unstable_mockModule('../utils/db.js', () => ({
	default: { query: jest.fn(), getConnection: jest.fn() },
}))

const fakeGraph = {
	nodes: [{ id: 'n1', lat: -26.19, lng: 28.03 }],
	edges: [['n1', 'n1']],
	zones: [{ id: 'z1', name: 'Zone One', bounds: {} }],
}

jest.unstable_mockModule('../placement/rotation_job.js', () => ({
	runRotation: jest.fn(),
	createProceduralEvents: jest.fn(),
	loadZoneLastUsed: jest.fn(),
	campusGraph: fakeGraph,
}))

const { default: pool } = await import('../utils/db.js')
const { runRotation, createProceduralEvents, loadZoneLastUsed } =
	await import('../placement/rotation_job.js')
const { DEFAULT_CONFIG } = await import('../placement/placement.js')
const { default: placementRouter } = await import('./placement.js')

import express from 'express'
import { createServer } from 'http'

function makeApp(sessionUser = { user_id: 1 }) {
	const session = sessionUser ? { user: sessionUser } : {}
	const app = express()
	app.use(express.json())
	app.use((req, _res, next) => {
		req.session = session
		req.user = sessionUser ?? null
		next()
	})
	app.use('/api/placement', placementRouter)
	return app
}

async function withServer(app, fn) {
	const server = createServer(app)
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const { port } = server.address()
	try {
		await fn(`http://127.0.0.1:${port}`)
	} finally {
		await new Promise((r) => server.close(r))
	}
}

beforeEach(() => {
	pool.query.mockReset()
	runRotation.mockReset()
	createProceduralEvents.mockReset()
	loadZoneLastUsed.mockReset()
})

describe('GET /api/placement/status', () => {
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/placement/status`)
			expect(res.status).toBe(401)
		})
	})

	test('403 when not an event author', async () => {
		pool.query.mockResolvedValueOnce([[]]) // admin_roles check: empty
		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/placement/status`)
			expect(res.status).toBe(403)
		})
	})

	test('200 returns config, activeEvents, graph, zones and recentRuns', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // admin_roles check: author
			.mockResolvedValueOnce([
				[
					{
						event_id: 1,
						title: 'Pop-up Quest: Zone One',
						zone: 'z1',
						starts_at: '2026-01-01 00:00:00',
						ends_at: '2026-01-01 02:00:00',
					},
				],
			]) // active procedural events
			.mockResolvedValueOnce([
				[
					{
						run_id: 1,
						status: 'SUCCESS',
						created_count: 3,
					},
				],
			]) // recent placement_runs
		loadZoneLastUsed.mockResolvedValueOnce({ z1: 12345 })

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/placement/status`)
			expect(res.status).toBe(200)
			const body = await res.json()

			expect(body.config).toEqual(DEFAULT_CONFIG)
			expect(body.activeEvents).toHaveLength(1)
			expect(body.activeEvents[0].zone).toBe('z1')
			expect(body.graph).toEqual({
				nodes: fakeGraph.nodes,
				edges: fakeGraph.edges,
			})
			expect(body.zones).toEqual([
				{
					id: 'z1',
					name: 'Zone One',
					bounds: {},
					lastUsed: 12345,
				},
			])
			expect(body.recentRuns).toHaveLength(1)
		})
	})

	test('unused zones report lastUsed: null', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([[]])
		loadZoneLastUsed.mockResolvedValueOnce({}) // no zone has ever been used

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/placement/status`)
			const body = await res.json()
			expect(body.zones).toEqual([
				{
					id: 'z1',
					name: 'Zone One',
					bounds: {},
					lastUsed: null,
				},
			])
		})
	})

	test('500 when a query fails', async () => {
		pool.query
			.mockResolvedValueOnce([[{ 1: 1 }]]) // author ok
			.mockRejectedValueOnce(new Error('db exploded'))

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(`${base}/api/placement/status`)
			expect(res.status).toBe(500)
			const body = await res.json()
			expect(body.error).toMatch(/db exploded/)
		})
	})
})

describe('POST /api/placement/generate', () => {
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/generate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(401)
		})
	})

	test('403 when not an event author', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/generate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(403)
		})
	})

	test('200 fills up to maxLive via createProceduralEvents, without retiring', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]]) // author ok
		createProceduralEvents.mockResolvedValueOnce({
			createdCount: 3,
			status: 'SUCCESS',
			error: null,
		})

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/generate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual({
				createdCount: 3,
				status: 'SUCCESS',
				error: null,
			})
		})
		expect(createProceduralEvents).toHaveBeenCalledWith(pool, {})
		expect(runRotation).not.toHaveBeenCalled()
	})

	test('500 when createProceduralEvents throws', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		createProceduralEvents.mockRejectedValueOnce(
			new Error('placement boom')
		)

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/generate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(500)
			const body = await res.json()
			expect(body.error).toMatch(/placement boom/)
		})
	})
})

describe('POST /api/placement/rotate', () => {
	test('401 when no session', async () => {
		const app = makeApp(null)
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/rotate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(401)
		})
	})

	test('403 when not an event author', async () => {
		pool.query.mockResolvedValueOnce([[]])
		const app = makeApp({ user_id: 5 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/rotate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(403)
		})
	})

	test('200 runs a full rotation via runRotation', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]]) // author ok
		runRotation.mockResolvedValueOnce({
			retiredCount: 1,
			createdCount: 2,
			status: 'SUCCESS',
			error: null,
		})

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/rotate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual({
				retiredCount: 1,
				createdCount: 2,
				status: 'SUCCESS',
				error: null,
			})
		})
		expect(runRotation).toHaveBeenCalledWith(pool, {})
	})

	// The route calls runRotation directly, bypassing the scheduler's
	// "is it due yet" check — so a rotation can always be demoed on demand.
	test('runs immediately regardless of whether a rotation is due', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		runRotation.mockResolvedValueOnce({
			retiredCount: 0,
			createdCount: 1,
			status: 'SUCCESS',
			error: null,
		})

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/rotate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(200)
		})
	})

	test('500 when runRotation throws', async () => {
		pool.query.mockResolvedValueOnce([[{ 1: 1 }]])
		runRotation.mockRejectedValueOnce(new Error('rotation boom'))

		const app = makeApp({ user_id: 1 })
		await withServer(app, async (base) => {
			const res = await fetch(
				`${base}/api/placement/rotate`,
				{
					method: 'POST',
				}
			)
			expect(res.status).toBe(500)
			const body = await res.json()
			expect(body.error).toMatch(/rotation boom/)
		})
	})
})
