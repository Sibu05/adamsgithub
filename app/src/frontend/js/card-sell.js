/**
 * "Sell duplicate" control for the collection page (user story I8).
 * Sells one spare copy through POST /api/cards/sell. The server refuses
 * to sell a player's last copy, and the button only exists while the
 * player has more than one.
 */
import { API_BASE } from './constants.js'

export async function sellDuplicate(cardId, quantity = 1) {
	const res = await fetch(`${API_BASE}/api/cards/sell`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ card_id: cardId, quantity }),
	})
	const data = await res.json().catch(() => ({}))
	if (!res.ok)
		throw new Error(data.error || `Sell failed (${res.status})`)
	return data
}

function sellLabel(card) {
	const value = Number(card.sell_value) || 0
	return value ? `Sell 1 duplicate (+${value} pts)` : 'Sell 1 duplicate'
}

/**
 * Adds the sell button to a collection card <li> when card.quantity > 1.
 * On success it updates card.quantity, the "×N" badge and the button
 * (removed once only one copy is left), then calls onSold(result).
 * onError(error) is called if the server refuses.
 */
export function attachSellButton(li, card, { onSold, onError } = {}) {
	if (!(card.quantity > 1)) return null

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'cc-sell-btn'
	btn.textContent = sellLabel(card)

	btn.addEventListener('click', async () => {
		btn.disabled = true
		try {
			const result = await sellDuplicate(card.card_id, 1)
			card.quantity = result.remaining_quantity

			const qty = li.querySelector('.cc-qty')
			if (card.quantity > 1) {
				if (qty) qty.textContent = `×${card.quantity}`
				btn.disabled = false
			} else {
				qty?.remove()
				btn.remove()
			}
			onSold?.(result, card)
		} catch (err) {
			btn.disabled = false
			onError?.(err, card)
		}
	})

	;(li.querySelector('.cc-footer') || li).appendChild(btn)
	return btn
}
