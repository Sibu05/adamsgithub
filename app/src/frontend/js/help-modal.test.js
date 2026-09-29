import { jest } from '@jest/globals'

import {
	helpContentFor,
	helpPages,
	buildHelpModalHTML,
	currentPageKey,
} from './help-modal.js'

// ── helpContentFor ──────────────────────────────────────────

describe('helpContentFor', () => {
	test('returns page-specific content for known keys', () => {
		const map = helpContentFor('map')
		expect(map.title).toMatch(/finding events/i)
		expect(map.body.length).toBeGreaterThan(0)
	})

	test('falls back to default for unknown keys', () => {
		const unknown = helpContentFor('does-not-exist')
		expect(unknown.title).toBe('Adamas to Aurum')
		expect(unknown.body.length).toBeGreaterThan(0)
	})

	test('falls back when key is undefined or null', () => {
		expect(helpContentFor(undefined).title).toBe('Adamas to Aurum')
		expect(helpContentFor(null).title).toBe('Adamas to Aurum')
	})
})

// ── helpPages ───────────────────────────────────────────────

describe('helpPages', () => {
	test('lists every authored page', () => {
		const pages = helpPages()
		expect(pages).toContain('map')
		expect(pages).toContain('events')
		expect(pages).toContain('collection')
		expect(pages).toContain('battle')
		expect(pages).toContain('leaderboard')
		expect(pages).toContain('trades')
		expect(pages).toContain('console')
		expect(pages).toContain('zones')
	})
})

// ── buildHelpModalHTML ──────────────────────────────────────

describe('buildHelpModalHTML', () => {
	test('renders a dialog with a title and bullet list', () => {
		const html = buildHelpModalHTML('map')
		expect(html).toContain('role="dialog"')
		expect(html).toContain('aria-modal="true"')
		expect(html).toContain('Finding events')
		expect(html).toContain('<ul class="help-list">')
	})

	test('each body line becomes an <li>', () => {
		const html = buildHelpModalHTML('leaderboard')
		const liCount = (html.match(/<li>/g) || []).length
		const { body } = helpContentFor('leaderboard')
		expect(liCount).toBe(body.length)
	})

	test('includes a close button', () => {
		const html = buildHelpModalHTML('battle')
		expect(html).toContain('help-close')
	})
})

// ── currentPageKey ──────────────────────────────────────────

describe('currentPageKey', () => {
	test('maps /pages/events.html to "events"', () => {
		expect(currentPageKey({ pathname: '/pages/events.html' })).toBe(
			'events'
		)
	})

	test('maps /pages/collection.html to "collection"', () => {
		expect(
			currentPageKey({ pathname: '/pages/collection.html' })
		).toBe('collection')
	})

	test('maps /pages/leaderboard.html to "leaderboard"', () => {
		expect(
			currentPageKey({ pathname: '/pages/leaderboard.html' })
		).toBe('leaderboard')
	})

	test('unknown paths fall back to "map"', () => {
		expect(currentPageKey({ pathname: '/' })).toBe('map')
		expect(currentPageKey({ pathname: '/pages/map.html' })).toBe(
			'map'
		)
	})

	test('case-insensitive', () => {
		expect(
			currentPageKey({ pathname: '/pages/CONSOLE.HTML' })
		).toBe('console')
	})
})
