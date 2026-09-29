import { jest } from '@jest/globals'
import {
	validateReport,
	openFeedbackDrawer,
	closeFeedbackDrawer,
	loadMyReports,
	initFeedback,
} from './feedback.js'

describe('validateReport', () => {
	test('accepts a complete report', () => {
		expect(
			validateReport({
				category: 'bug',
				title: 'Map froze',
				body: 'Pins stopped loading.',
			})
		).toBeNull()
	})
	test('rejects bad category and missing fields', () => {
		expect(
			validateReport({
				category: 'NOPE',
				title: 't',
				body: 'b',
			})
		).toMatch(/category/i)
		expect(
			validateReport({
				category: 'BUG',
				title: '',
				body: 'b',
			})
		).toMatch(/title/i)
		expect(
			validateReport({
				category: 'BUG',
				title: 't',
				body: '',
			})
		).toMatch(/descri/i)
		expect(
			validateReport({
				category: 'BUG',
				title: 'x'.repeat(201),
				body: 'b',
			})
		).toMatch(/200/)
	})
})

describe('feedback drawer', () => {
	beforeEach(() => {
		document.body.innerHTML = `
			<div id="feedback-overlay"></div>
			<div id="feedback-drawer"></div>
			<div id="feedback-gate"></div>
			<form id="feedback-report-form">
				<select id="feedback-category"><option value="BUG">Bug</option></select>
				<input id="feedback-title" />
				<textarea id="feedback-body"></textarea>
			</form>
			<div id="feedback-mine" class="hidden">
				<div id="feedback-mine-empty" class="hidden"></div>
				<ul id="feedback-mine-list"></ul>
			</div>
			<div id="feedback-status"></div>
			<button id="feedback-signin-btn"></button>
		`
		global.fetch = jest.fn()
	})
	afterEach(() => {
		document.body.innerHTML = ''
		jest.restoreAllMocks()
	})
	test('open/close toggles the drawer', () => {
		openFeedbackDrawer()
		expect(
			document
				.getElementById('feedback-drawer')
				.classList.contains('open')
		).toBe(true)
		closeFeedbackDrawer()
		expect(
			document
				.getElementById('feedback-drawer')
				.classList.contains('open')
		).toBe(false)
	})
	test('logged-out players see the sign-in gate', async () => {
		initFeedback({ getUser: () => null, openAuth: jest.fn() })
		document.getElementById('feedback-drawer').setAttribute(
			'class',
			'open'
		)
		await new Promise((r) => setTimeout(r, 0))
		expect(
			document
				.getElementById('feedback-report-form')
				.classList.contains('hidden')
		).toBe(true)
		expect(
			document
				.getElementById('feedback-gate')
				.classList.contains('hidden')
		).toBe(false)
	})
	test('logged-in submit posts and refreshes my reports', async () => {
		global.fetch
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ report_id: 1 }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						report_id: 1,
						title: 'Map froze',
						status: 'NEW',
					},
				],
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						report_id: 1,
						title: 'Map froze',
						status: 'NEW',
					},
				],
			})
		initFeedback({
			getUser: () => ({ user_id: 2 }),
			openAuth: jest.fn(),
		})
		document.getElementById('feedback-drawer').setAttribute(
			'class',
			'open'
		)
		document.getElementById('feedback-title').value = 'Map froze'
		document.getElementById('feedback-body').value = 'Pins broke.'
		document.getElementById('feedback-report-form').dispatchEvent(
			new Event('submit', { cancelable: true })
		)
		await new Promise((r) => setTimeout(r, 0))
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/feedback'),
			expect.objectContaining({ method: 'POST' })
		)
		expect(
			document.getElementById('feedback-status').textContent
		).toMatch(/logged/i)
	})
	test('loadMyReports renders status pills', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => [
				{ report_id: 1, title: 'A', status: 'NEW' },
				{
					report_id: 2,
					title: 'B',
					status: 'RESOLVED',
				},
			],
		})
		await loadMyReports()
		const items = document.querySelectorAll(
			'#feedback-mine-list li'
		)
		expect(items).toHaveLength(2)
		expect(items[1].textContent).toMatch(/Resolved/)
	})
})
