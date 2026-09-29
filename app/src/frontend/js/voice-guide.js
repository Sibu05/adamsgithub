/**
 * Voice guide for the map pages. Uses the browser's built-in
 * speechSynthesis API (zero dependencies, works in every modern
 * browser) to read event information aloud when the user clicks the
 * speaker icon on an event popup.
 *
 * Deliberately manual: we do NOT auto-speak when a popup opens.
 * Browsing the map shouldn't trigger a narration of every event the
 * player taps, and for users running a screen reader, a second voice
 * talking over it is disorienting. The speaker icon makes it
 * deliberate.
 */

import { formatDistance } from './event-status.js'

const MUTE_KEY = 'a2a_voice_muted'

// Average adult walking speed over flat ground, in metres per second.
// Slower than running, faster than a slow amble. Real-world times vary
// ±30% depending on terrain and pace; we round to the nearest minute
// so precision isn't implied.
const WALKING_SPEED_MPS = 1.4

/**
 * Are we on a browser that can speak? False on very old browsers, and
 * also false in some headless test environments.
 */
export function isVoiceSupported() {
	return (
		typeof window !== 'undefined' &&
		'speechSynthesis' in window &&
		typeof window.SpeechSynthesisUtterance === 'function'
	)
}

/**
 * Has the user muted voice output? Persisted in localStorage so the
 * choice survives page reloads. Default is unmuted.
 */
export function isMuted() {
	try {
		return localStorage.getItem(MUTE_KEY) === '1'
	} catch {
		return false
	}
}

/** Toggle mute state. Returns the new muted value. */
export function toggleMute() {
	const next = !isMuted()
	try {
		localStorage.setItem(MUTE_KEY, next ? '1' : '0')
	} catch {
		/* storage unavailable — silently ignore */
	}
	if (next) cancelSpeech()
	return next
}

/** Stop any speech currently in progress. */
export function cancelSpeech() {
	if (isVoiceSupported()) {
		try {
			window.speechSynthesis.cancel()
		} catch {
			/* no-op */
		}
	}
}

/**
 * Speak the given text. No-ops silently if voice is unsupported or
 * muted. Cancels any speech already in progress so a fast series of
 * clicks doesn't queue up.
 */
export function speak(text, { lang = 'en-ZA', rate = 0.95 } = {}) {
	if (!isVoiceSupported() || isMuted()) return false
	try {
		window.speechSynthesis.cancel()
		const utter = new window.SpeechSynthesisUtterance(text)
		utter.lang = lang
		utter.rate = rate
		window.speechSynthesis.speak(utter)
		return true
	} catch {
		return false
	}
}

/**
 * Estimate walking time in seconds to cover the given distance (metres).
 * Returns null for null/negative/invalid distances.
 */
export function estimateWalkSeconds(distanceM) {
	if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0) {
		return null
	}
	return Math.round(distanceM / WALKING_SPEED_MPS)
}

/**
 * Human-friendly walking time: "under a minute", "about 3 minutes",
 * "about 1 hour". Deliberately coarse — a range or approximation reads
 * naturally aloud and doesn't imply we've measured the player's pace.
 */
export function formatWalkTime(seconds) {
	if (seconds == null) return null
	if (seconds < 30) return 'under a minute'
	if (seconds < 90) return 'about a minute'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `about ${minutes} minutes`
	const hours = Math.round(minutes / 60)
	return hours === 1 ? 'about an hour' : `about ${hours} hours`
}

/**
 * Build the sentence the voice guide reads for an event. Kept as a
 * pure function so it's easy to test without touching speechSynthesis.
 *
 * @param {object} ev       event row (title, latitude, longitude)
 * @param {object} state    result of eventState(ev, playerLngLat)
 * @returns {string}
 */
export function buildEventAnnouncement(ev, state) {
	const title = String(ev.title || 'This event')
	if (state.distanceM == null) {
		return `${title}. I don't have your location yet, so I can't estimate how long it will take to get there.`
	}
	const distance = formatDistance(state.distanceM)
	const walk = formatWalkTime(estimateWalkSeconds(state.distanceM))

	if (state.status === 'EXPIRED') {
		return `${title}. This event has already ended.`
	}
	if (state.status === 'UPCOMING') {
		return `${title}. This event hasn't started yet. It's ${distance} away, about ${walk} to walk.`
	}
	if (state.canAttempt) {
		return `${title}. You're ${distance} away — you're close enough to attempt the challenge right now.`
	}
	return `${title}. You're ${distance} away. It will take you about ${walk} to walk there.`
}

/**
 * Announce an event. Thin wrapper over speak(buildEventAnnouncement(...))
 * so the map pages have a single call site.
 */
export function announceEvent(ev, state) {
	return speak(buildEventAnnouncement(ev, state))
}