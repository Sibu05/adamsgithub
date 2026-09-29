/**
 * Contextual help modal. One floating "?" button (or header button)
 * opens a small card that explains what the current page is for, using
 * plain language and no external dependency.
 *
 * Content is keyed by page, not by URL — map.html, events.html and
 * index.html all render the map, so they get the same help text.
 *
 * Deliberately a modal, not a guided tour. Users come to help when they
 * are already confused; a walkthrough overlay would just get in the way
 * of the thing they were trying to do.
 */

const HELP_CONTENT = {
	map: {
		title: 'Finding events',
		body: [
			'Tap any marker to see what the event is about.',
			'Green badge = you are inside the radius and can attempt the challenge right now.',
			'Walk closer and the badge turns green as you arrive.',
			'Click the speaker icon in a popup to hear the distance and walking time read aloud.',
		],
	},
	events: {
		title: 'Events list',
		body: [
			'Every live event on campus appears here.',
			"Click one to jump to it on the map, or to start its challenge if you're in range.",
			'Expired events are hidden automatically.',
			'The next-up banner points you at the closest event you have not done yet.',
		],
	},
	collection: {
		title: 'Your cards',
		body: [
			'Cards you earn from answering event challenges appear here.',
			'Duplicates can be sold for points — they do not sit dead in your collection.',
			'Build a deck of five to take into a battle.',
			'At most one Legendary card per deck.',
		],
	},
	battle: {
		title: 'Battling',
		body: [
			'Pick a deck of five cards, then choose an attribute each round.',
			'Higher attribute value wins the round.',
			'Some cards have special abilities — read them before you play.',
			'You can battle the CPU or another player.',
		],
	},
	leaderboard: {
		title: 'Leaderboard',
		body: [
			'Ranked by total points earned from event challenges.',
			'Your own row is highlighted and marked "You".',
			'Play more events to climb the board.',
			'Pagination below the table moves through longer lists.',
		],
	},
	trades: {
		title: 'Trading cards',
		body: [
			'Offer one of your cards in exchange for one of someone else\u2019s.',
			'Both sides must accept before the swap happens.',
			'The trade is atomic — either both cards move, or neither does.',
			'Limits: max 5 trades per day, and the two cards must be of comparable rarity.',
		],
	},
	console: {
		title: 'Authoring console',
		body: [
			'Create and edit events, questions, cards and campaigns.',
			'Nothing goes live until you publish it.',
			'Analytics show which events players actually engage with.',
		],
	},
	zones: {
		title: 'Zones',
		body: [
			'Every event is a zone. The player with the most recent points from an event owns its zone.',
			'You keep a zone until someone outscores you by 20%.',
			'Own 3+ zones and you earn a daily points bonus.',
		],
	},
}

/** Default content when the page id is unknown. */
const DEFAULT_CONTENT = {
	title: 'Adamas to Aurum',
	body: [
		'Explore campus. Find events. Answer questions. Collect cards.',
		'Open the map to see what is nearby.',
		'Click the ? button on any page to get page-specific help.',
	],
}

/**
 * Return the help content for a page key. Unknown keys fall back to
 * the default. Pure function so it is easy to test.
 */
export function helpContentFor(pageKey) {
	return HELP_CONTENT[pageKey] ?? DEFAULT_CONTENT
}

/** All page keys with authored help content. */
export function helpPages() {
	return Object.keys(HELP_CONTENT)
}

/**
 * Build the modal DOM. Injects into <body> on first call, then reuses
 * the same element on subsequent calls so we do not accumulate nodes.
 * Content is fully escaped by the builder (no innerHTML from user data).
 */
export function buildHelpModalHTML(pageKey) {
	const { title, body } = helpContentFor(pageKey)
	const items = body.map((line) => `<li>${line}</li>`).join('')
	return `
		<div class="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
			<div class="help-modal-inner">
				<button class="help-close" aria-label="Close help">&times;</button>
				<h2 id="help-modal-title">${title}</h2>
				<ul class="help-list">${items}</ul>
			</div>
		</div>
	`
}

/**
 * Render the modal for a page. Idempotent: if a modal already exists it
 * is replaced. Returns the modal element so callers can attach listeners.
 */
export function renderHelpModal(pageKey) {
	let el = document.getElementById('help-modal')
	if (!el) {
		el = document.createElement('div')
		el.id = 'help-modal'
		document.body.appendChild(el)
	}
	el.innerHTML = buildHelpModalHTML(pageKey)
	return el
}

/**
 * Open the help modal for a page. Attaches a click handler on the
 * backdrop (outside the modal-inner) and the close button so both close
 * it. Also closes on Escape.
 */
export function openHelpModal(pageKey) {
	const el = renderHelpModal(pageKey)

	const close = () => {
		el.remove()
		document.removeEventListener('keydown', onKey)
	}

	const onKey = (e) => {
		if (e.key === 'Escape') close()
	}

	el.addEventListener('click', (e) => {
		// Close on backdrop click, but not when the user clicked inside
		// the modal body (would be annoying while reading).
		if (e.target === el) close()
	})
	el.querySelector('.help-close')?.addEventListener('click', close)
	document.addEventListener('keydown', onKey)

	return el
}

/**
 * Wire a button (by id) to open the help modal for a given page key.
 * Safe to call even if the button is absent.
 */
export function attachHelpButton(buttonId, pageKey) {
	const btn = document.getElementById(buttonId)
	if (!btn) return false
	btn.addEventListener('click', () => openHelpModal(pageKey))
	return true
}

/**
 * Guess the page key from the current URL. Used by pages that do not
 * want to hard-code a key.
 */
export function currentPageKey(location = window.location) {
	const path = String(location.pathname || '').toLowerCase()
	if (path.includes('collection')) return 'collection'
	if (path.includes('battle')) return 'battle'
	if (path.includes('leaderboard')) return 'leaderboard'
	if (path.includes('trades')) return 'trades'
	if (path.includes('console')) return 'console'
	if (path.includes('zones')) return 'zones'
	if (path.includes('events')) return 'events'
	return 'map'
}
