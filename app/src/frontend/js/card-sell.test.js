import { jest } from '@jest/globals'
import { API_BASE } from './constants.js'
import { attachSellButton, sellDuplicate } from './card-sell.js'

function cardLi(quantity) {
	const li = document.createElement('li')
	li.innerHTML = `<div class="cc-footer">Obtained today${
		quantity > 1 ? `<span class="cc-qty">×${quantity}</span>` : ''
	}</div>`
	return li
}

function mockSell(responses) {
	global.fetch = jest.fn()
	for (const [status, body] of responses)
		global.fetch.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		})
}

const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
	delete global.fetch
})

describe('attachSellButton', () => {
	test('no button when the player only has one copy', () => {
		const li = cardLi(1)
		expect(
			attachSellButton(li, { card_id: 1, quantity: 1 })
		).toBeNull()
		expect(li.querySelector('.cc-sell-btn')).toBeNull()
	})

	test('button shows the sell value when quantity > 1', () => {
		const li = cardLi(3)
		attachSellButton(li, {
			card_id: 1,
			quantity: 3,
			sell_value: 20,
		})
		const btn = li.querySelector('.cc-footer .cc-sell-btn')
		expect(btn.textContent).toBe('Sell 1 duplicate (+20 pts)')
	})

	test('selling updates the ×N badge and reports points to onSold', async () => {
		mockSell([
			[
				200,
				{
					success: true,
					points_earned: 20,
					remaining_quantity: 2,
					points_total: 120,
				},
			],
		])
		const li = cardLi(3)
		const card = { card_id: 7, quantity: 3, sell_value: 20 }
		const onSold = jest.fn()
		attachSellButton(li, card, { onSold })

		li.querySelector('.cc-sell-btn').click()
		await flush()

		const [url, init] = global.fetch.mock.calls[0]
		expect(url).toBe(`${API_BASE}/api/cards/sell`)
		expect(JSON.parse(init.body)).toEqual({
			card_id: 7,
			quantity: 1,
		})
		expect(card.quantity).toBe(2)
		expect(li.querySelector('.cc-qty').textContent).toBe('×2')
		expect(li.querySelector('.cc-sell-btn').disabled).toBe(false)
		expect(onSold).toHaveBeenCalledWith(
			expect.objectContaining({ points_total: 120 }),
			card
		)
	})

	test('selling down to the last copy removes the button and the badge', async () => {
		mockSell([
			[
				200,
				{
					points_earned: 5,
					remaining_quantity: 1,
					points_total: 5,
				},
			],
		])
		const li = cardLi(2)
		attachSellButton(li, { card_id: 1, quantity: 2, sell_value: 5 })
		li.querySelector('.cc-sell-btn').click()
		await flush()
		expect(li.querySelector('.cc-sell-btn')).toBeNull()
		expect(li.querySelector('.cc-qty')).toBeNull()
	})

	test('a server refusal re-enables the button and calls onError', async () => {
		mockSell([[400, { error: "can't sell your last copy" }]])
		const li = cardLi(2)
		const card = { card_id: 1, quantity: 2 }
		const onError = jest.fn()
		attachSellButton(li, card, { onError })
		li.querySelector('.cc-sell-btn').click()
		await flush()
		expect(onError.mock.calls[0][0].message).toBe(
			"can't sell your last copy"
		)
		expect(card.quantity).toBe(2)
		expect(li.querySelector('.cc-sell-btn').disabled).toBe(false)
	})
})

describe('sellDuplicate', () => {
	test('throws with a status message when the body has no error', async () => {
		mockSell([[500, {}]])
		await expect(sellDuplicate(1)).rejects.toThrow(
			'Sell failed (500)'
		)
	})
})
