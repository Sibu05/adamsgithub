/**
 * In-app feedback drawer ("Help us improve", opened from the profile
 * menu on the main map). Logged-in players file an issue report and see
 * their own reports with live triage status. Logged-out players get a
 * Sign In prompt instead of the form.
 */

import { API_BASE } from './constants.js'

export const FEEDBACK_CATEGORIES = [
	'BUG',
	'ACCOUNT',
	'LOCATION',
	'CONTENT',
	'OTHER',
]

export function validateReport({ category, title, body }) {
	const cat = String(category || 'OTHER').toUpperCase()
	if (!FEEDBACK_CATEGORIES.includes(cat))
		return 'Pick a category for your report.'
	const t = String(title || '').trim()
	if (!t) return 'Give your report a short title.'
	if (t.length > 200) return 'Title is too long (max 200 characters).'
	const b = String(body || '').trim()
	if (!b) return 'Describe what happened.'
	if (b.length > 5000)
		return 'Description is too long (max 5000 characters).'
	return null
}

function setFeedbackStatus(message, isError) {
	const el = document.getElementById('feedback-status')
	if (!el) return
	el.textContent = message
	el.className = `feedback-status ${isError ? 'error' : 'success'}`
}

export function openFeedbackDrawer() {
	document.getElementById('feedback-overlay')?.classList.add('open')
	document.getElementById('feedback-drawer')?.classList.add('open')
}

export function closeFeedbackDrawer() {
	document.getElementById('feedback-overlay')?.classList.remove('open')
	document.getElementById('feedback-drawer')?.classList.remove('open')
}

function pillClass(status) {
	if (status === 'ACKNOWLEDGED') return 'feedback-pill ack'
	if (status === 'RESOLVED') return 'feedback-pill res'
	return 'feedback-pill'
}

function pillLabel(status) {
	if (status === 'ACKNOWLEDGED') return 'Acknowledged'
	if (status === 'RESOLVED') return 'Resolved'
	return 'New'
}

export async function loadMyReports() {
	const list = document.getElementById('feedback-mine-list')
	const empty = document.getElementById('feedback-mine-empty')
	if (!list) return
	list.innerHTML = ''
	empty?.classList.add('hidden')
	try {
		const res = await fetch(`${API_BASE}/api/feedback/mine`, {
			credentials: 'include',
		})
		if (!res.ok) return
		const reports = await res.json()
		if (!reports.length) {
			empty?.classList.remove('hidden')
			return
		}
		reports.forEach((r) => {
			const li = document.createElement('li')
			li.className = 'feedback-mine-item'
			const title = document.createElement('span')
			title.className = 'feedback-mine-title'
			title.textContent = r.title
			const pill = document.createElement('span')
			pill.className = pillClass(r.status)
			pill.textContent = pillLabel(r.status)
			li.append(title, pill)
			list.appendChild(li)
		})
	} catch {
		// Offline — the form still validates; the list just stays empty.
	}
}

/**
 * Wire the drawer. getUser is a thunk returning the logged-in user or
 * null (main.js owns the session). openAuth opens the auth drawer for
 * the logged-out prompt.
 */
export function initFeedback({ getUser, openAuth }) {
	window.openFeedbackDrawer = openFeedbackDrawer
	window.closeFeedbackDrawer = closeFeedbackDrawer

	document.getElementById('feedback-signin-btn')?.addEventListener(
		'click',
		() => {
			closeFeedbackDrawer()
			openAuth?.()
		}
	)

	function refreshGate() {
		const gate = document.getElementById('feedback-gate')
		const form = document.getElementById('feedback-report-form')
		const mine = document.getElementById('feedback-mine')
		if (!gate || !form) return
		if (getUser?.()) {
			gate.classList.add('hidden')
			form.classList.remove('hidden')
			mine?.classList.remove('hidden')
			loadMyReports()
		} else {
			form.classList.add('hidden')
			mine?.classList.add('hidden')
			gate.classList.remove('hidden')
		}
	}

	// Refresh the gate every time the drawer opens (session may change).
	const drawer = document.getElementById('feedback-drawer')
	if (drawer)
		new MutationObserver(refreshGate).observe(drawer, {
			attributes: true,
		})

	document.getElementById('feedback-report-form')?.addEventListener(
		'submit',
		async (e) => {
			e.preventDefault()
			if (!getUser?.()) {
				setFeedbackStatus(
					'Please sign in to send feedback.',
					true
				)
				return
			}
			const category =
				document.getElementById(
					'feedback-category'
				)?.value
			const title =
				document.getElementById('feedback-title')
					?.value || ''
			const body =
				document.getElementById('feedback-body')
					?.value || ''
			const problem = validateReport({
				category,
				title,
				body,
			})
			if (problem) {
				setFeedbackStatus(problem, true)
				return
			}
			setFeedbackStatus('Sending…', false)
			try {
				const res = await fetch(
					`${API_BASE}/api/feedback`,
					{
						method: 'POST',
						credentials: 'include',
						headers: {
							'Content-Type':
								'application/json',
						},
						body: JSON.stringify({
							category,
							title: title.trim(),
							body: body.trim(),
						}),
					}
				)
				const data = await res.json().catch(() => ({}))
				if (!res.ok)
					throw new Error(
						data.error ||
							`Server error ${res.status}`
					)
				setFeedbackStatus(
					'Thanks — your report was logged.',
					false
				)
				document.getElementById(
					'feedback-title'
				).value = ''
				document.getElementById('feedback-body').value =
					''
				loadMyReports()
			} catch (err) {
				setFeedbackStatus(
					`Could not send: ${err.message}`,
					true
				)
			}
		}
	)
}
