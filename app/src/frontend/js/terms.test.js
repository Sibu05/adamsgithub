import { jest } from '@jest/globals'
import {
	showTermsModal,
	hideTermsModal,
	ensureTermsAccepted,
	initTermsGate,
} from './terms.js'

describe('terms gate', () => {
	beforeEach(() => {
		document.body.innerHTML = `
			<div id="terms-overlay"></div>
			<div id="terms-modal"></div>
			<div id="terms-modal-status"></div>
			<button id="btn-accept-terms"></button>
			<button id="btn-decline-terms"></button>
		`
		global.fetch = jest.fn()
	})
	afterEach(() => {
		document.body.innerHTML = ''
		jest.restoreAllMocks()
	})
	test('open/close toggles the modal', async () => {
		const { showTermsModal: show } = await import('./terms.js')
		show()
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(true)
		hideTermsModal()
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(false)
	})
	test('no gate when already accepted', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ accepted: true }),
		})
		expect(await ensureTermsAccepted()).toBe(false)
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(false)
	})
	test('gate shows when acceptance is missing', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				accepted: false,
				current_version: '1.0',
			}),
		})
		expect(await ensureTermsAccepted()).toBe(true)
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(true)
	})
	test('accept posts and closes the modal', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ accepted: true, version: '1.0' }),
		})
		initTermsGate({ onDecline: jest.fn() })
		showTermsModal()
		document.getElementById('btn-accept-terms').click()
		await new Promise((r) => setTimeout(r, 0))
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('/api/auth/accept-terms'),
			expect.objectContaining({ method: 'POST' })
		)
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(false)
	})
	test('decline closes and calls onDecline', async () => {
		const onDecline = jest.fn()
		initTermsGate({ onDecline })
		showTermsModal()
		document.getElementById('btn-decline-terms').click()
		expect(onDecline).toHaveBeenCalled()
		expect(
			document
				.getElementById('terms-modal')
				.classList.contains('open')
		).toBe(false)
	})
})
