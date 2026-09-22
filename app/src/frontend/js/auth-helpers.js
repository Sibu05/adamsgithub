/**
 * Shared auth utilities used across the frontend.
 *
 * This keeps the admin-role check and post-login redirect in one place so
 * every page behaves the same way after a successful login. It also owns
 * the header account menu: a circular avatar button + dropdown used on
 * both player pages and the admin console.
 */

import { API_BASE } from './constants.js'
import { svgIcon } from './icons.js'

export const ADMIN_ROLES = [
	'SUPER_ADMIN',
	'EVENT_AUTHOR',
	'CARD_AUTHOR',
	'MODERATOR',
]
export const MODERATOR_ROLES = ['SUPER_ADMIN', 'MODERATOR']

export function isAdmin(user) {
	return (user?.roles || []).some((role) => ADMIN_ROLES.includes(role))
}

export function isModerator(user) {
	return (user?.roles || []).some((role) =>
		MODERATOR_ROLES.includes(role)
	)
}

/**
 * Redirect the user to the right landing page after authentication.
 * Admins/authors go to the console; everyone else goes to the player
 * dashboard (events list).
 */
export function redirectAfterLogin(user) {
	if (isAdmin(user)) {
		window.location.href = '/pages/console.html'
	} else {
		window.location.href = '/pages/events.html'
	}
}

/**
 * Update the shared header to reflect the current auth state.
 * Logged in: circular avatar button + dropdown (account actions), player
 * nav links (or Console link for admins). Logged out: Sign In link only.
 * The legacy #user-badge / #btn-logout elements are hidden whenever the
 * avatar menu is present but left in the DOM for backwards compatibility.
 */
export function updateAuthNav(user) {
	const badge = document.getElementById('user-badge')
	const btnLogout = document.getElementById('btn-logout')
	const btnSignin = document.getElementById('btn-signin')
	const navConsole = document.getElementById('nav-console')
	const playerLinks = [
		'nav-events',
		'nav-collection',
		'nav-battle',
		'nav-leaderboard',
	].map((id) => document.getElementById(id))

	if (user) {
		if (badge) badge.classList.add('hidden')
		if (btnLogout) btnLogout.classList.add('hidden')
		if (btnSignin) btnSignin.classList.add('hidden')
		ensureAccountMenu(user)

		if (isAdmin(user)) {
			playerLinks.forEach((el) => el?.classList.add('hidden'))
			if (navConsole) navConsole.classList.remove('hidden')
		} else {
			playerLinks.forEach((el) =>
				el?.classList.remove('hidden')
			)
			if (navConsole) navConsole.classList.add('hidden')
		}
	} else {
		removeAccountMenu()
		if (badge) badge.classList.add('hidden')
		if (btnLogout) btnLogout.classList.add('hidden')
		if (btnSignin) btnSignin.classList.remove('hidden')
		playerLinks.forEach((el) => el?.classList.add('hidden'))
		if (navConsole) navConsole.classList.add('hidden')
	}
}

// ---------------------------------------------------------------------------
// Circular profile avatar + dropdown. One shared component for player pages
// and the admin console (admin header shows role instead of points).
// ---------------------------------------------------------------------------

function initialsFor(name) {
	if (!name || !name.trim()) return ''
	const parts = name.trim().split(/\s+/)
	return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

// Avatar face: initials when we have a name, person icon otherwise.
function renderAvatarFace(el, name) {
	const initials = initialsFor(name)
	if (initials) {
		el.textContent = initials
	} else {
		el.innerHTML = svgIcon('user')
	}
}

function notify(msg) {
	const toast = document.getElementById('toast')
	if (toast) {
		toast.textContent = msg
		toast.className = 'toast show'
		clearTimeout(notify._t)
		notify._t = setTimeout(() => {
			toast.className = 'toast'
		}, 2600)
		return
	}
	const el = document.createElement('div')
	el.className = 'acct-toast'
	el.textContent = msg
	document.body.appendChild(el)
	setTimeout(() => el.remove(), 2600)
}

export async function logout() {
	try {
		await Promise.allSettled([
			fetch(`${API_BASE}/api/auth/logout`, {
				method: 'POST',
				credentials: 'include',
			}),
			fetch(`${API_BASE}/api/auth/sign-out`, {
				method: 'POST',
				credentials: 'include',
			}),
		])
	} catch (err) {
		console.warn('Logout error:', err)
	} finally {
		removeAccountMenu()
		window.location.href = '/'
	}
}

function menuSubLabel(user) {
	if (
		typeof user.total_points === 'number' ||
		typeof user.points === 'number'
	) {
		const pts = user.total_points ?? user.points
		const lvl =
			user.level !== undefined && user.level !== null
				? `Level ${user.level} · `
				: ''
		return `${lvl}${pts} pts`
	}
	if (isAdmin(user)) {
		const role = (user.roles || [])[0]
		return role
			? role
					.replace(/_/g, ' ')
					.toLowerCase()
					.replace(/\b\w/g, (c) =>
						c.toUpperCase()
					)
			: 'Admin'
	}
	return ''
}

function closeMenu(wrap) {
	wrap?.querySelector('.acct-menu')?.remove()
	wrap?.querySelector('.acct-avatar')?.setAttribute(
		'aria-expanded',
		'false'
	)
	if (closeMenu._outside) {
		document.removeEventListener('click', closeMenu._outside, true)
		closeMenu._outside = null
	}
}

function ensureAccountMenu(user) {
	const anchor =
		document.querySelector('.header-right') ||
		document.getElementById('auth-nav-container')
	if (!anchor) return

	let wrap = anchor.querySelector('.acct-wrap')
	if (wrap) {
		// Refresh the header for the current user (name may change).
		const btn = wrap.querySelector('.acct-avatar')
		if (btn) {
			renderAvatarFace(btn, user.name)
			btn.setAttribute(
				'aria-label',
				`Account menu for ${user.name || 'player'}`
			)
		}
		const nameEl = wrap.querySelector('.acct-menu-name')
		if (nameEl) nameEl.textContent = user.name || 'Player'
		const subEl = wrap.querySelector('.acct-menu-sub')
		if (subEl) {
			const sub = menuSubLabel(user)
			subEl.textContent = sub
			subEl.style.display = sub ? '' : 'none'
		}
		return
	}

	wrap = document.createElement('div')
	wrap.className = 'acct-wrap'

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'acct-avatar'
	renderAvatarFace(btn, user.name)
	btn.setAttribute('aria-haspopup', 'menu')
	btn.setAttribute('aria-expanded', 'false')
	btn.setAttribute(
		'aria-label',
		`Account menu for ${user.name || 'player'}`
	)

	const sub = menuSubLabel(user)
	const items = [
		{
			icon: 'pencil',
			label: 'Edit username',
			soon: 'Username editing is coming soon.',
		},
		{
			icon: 'key',
			label: 'Change password',
			soon: 'Password changes are coming soon.',
		},
		{
			icon: 'settings',
			label: 'Settings',
			soon: 'Settings are coming soon.',
		},
		{ divider: true },
		{ icon: 'log-out', label: 'Logout', action: logout },
		{
			icon: 'trash',
			label: 'Delete account',
			danger: true,
			disabled: true,
			title: 'Account deletion needs a confirmation step — coming soon.',
		},
	]

	btn.addEventListener('click', (e) => {
		e.stopPropagation()
		if (wrap.querySelector('.acct-menu')) {
			closeMenu(wrap)
			return
		}
		const menu = document.createElement('div')
		menu.className = 'acct-menu'
		menu.setAttribute('role', 'menu')

		const header = document.createElement('div')
		header.className = 'acct-menu-header'
		header.innerHTML = `<div class="acct-menu-avatar"></div>
			<div><div class="acct-menu-name"></div>
			<div class="acct-menu-sub"${sub ? '' : ' style="display:none"'}></div></div>`
		header.querySelector('.acct-menu-avatar').textContent =
			initialsFor(user.name) || ''
		if (!initialsFor(user.name)) {
			header.querySelector('.acct-menu-avatar').innerHTML =
				svgIcon('user')
		}
		header.querySelector('.acct-menu-name').textContent =
			user.name || 'Player'
		header.querySelector('.acct-menu-sub').textContent = sub
		menu.appendChild(header)

		for (const item of items) {
			if (item.divider) {
				const hr = document.createElement('hr')
				hr.className = 'acct-menu-divider'
				menu.appendChild(hr)
				continue
			}
			const el = document.createElement('button')
			el.type = 'button'
			el.className =
				'acct-menu-item' +
				(item.danger ? ' acct-menu-danger' : '')
			el.setAttribute('role', 'menuitem')
			if (item.disabled) {
				el.disabled = true
				if (item.title) el.title = item.title
			}
			el.innerHTML = `<span class="acct-menu-icon">${svgIcon(item.icon)}</span><span></span>`
			el.lastChild.textContent = item.label
			el.addEventListener('click', () => {
				if (item.action) {
					closeMenu(wrap)
					item.action()
				} else if (item.soon) {
					closeMenu(wrap)
					notify(item.soon)
				}
			})
			menu.appendChild(el)
		}

		menu.addEventListener('click', (e) => e.stopPropagation())
		wrap.appendChild(menu)
		btn.setAttribute('aria-expanded', 'true')

		// Close on outside click or Escape.
		closeMenu._outside = (e) => {
			if (!wrap.contains(e.target)) closeMenu(wrap)
		}
		document.addEventListener('click', closeMenu._outside, true)
		const onKey = (e) => {
			if (e.key === 'Escape') {
				closeMenu(wrap)
				document.removeEventListener('keydown', onKey)
			}
		}
		document.addEventListener('keydown', onKey)
	})

	wrap.appendChild(btn)
	anchor.prepend(wrap)
}

function removeAccountMenu() {
	const wrap = document.querySelector('.acct-wrap')
	closeMenu(wrap)
	wrap?.remove()
}
