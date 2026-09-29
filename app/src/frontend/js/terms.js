/**
 * Terms-of-use acceptance gate (main map only).
 *
 * PIN registrations accept inline at signup. Google sign-ins land
 * with a session but no acceptance record, so after login we check
 * GET /api/auth/terms-status and show a blocking modal until the
 * player accepts (POST /api/auth/accept-terms) or logs out.
 */

import { getTermsStatus, acceptTerms } from './auth-client.js'

export function showTermsModal() {
	document.getElementById('terms-overlay')?.classList.add('open')
	document.getElementById('terms-modal')?.classList.add('open')
}

export function hideTermsModal() {
	document.getElementById('terms-overlay')?.classList.remove('open')
	document.getElementById('terms-modal')?.classList.remove('open')
}

function setTermsStatus(message, isError) {
	const el = document.getElementById('terms-modal-status')
	if (!el) return
	el.textContent = message
	el.className = `auth-status visible ${isError ? 'error' : 'success'}`
}

/**
 * Returns true when the gate was shown (caller should pause), false
 * when the session already satisfies the current terms.
 */
export async function ensureTermsAccepted() {
	const { data, error } = await getTermsStatus()
	if (error || !data) return false
	if (data.accepted) return false
	showTermsModal()
	return true
}

export function initTermsGate({ onDecline }) {
	document.getElementById('btn-accept-terms')?.addEventListener(
		'click',
		async () => {
			setTermsStatus('Recording…', false)
			const { error } = await acceptTerms()
			if (error) {
				setTermsStatus(
					`Could not save: ${error.message}`,
					true
				)
				return
			}
			hideTermsModal()
		}
	)
	document.getElementById('btn-decline-terms')?.addEventListener(
		'click',
		() => {
			hideTermsModal()
			onDecline?.()
		}
	)
}
