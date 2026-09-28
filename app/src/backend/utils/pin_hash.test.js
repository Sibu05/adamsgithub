import crypto from 'crypto'
import { hashPin, verifyPin, isValidPin, isLegacyHash } from './pin_hash.js'

const sha256 = (pin) => crypto.createHash('sha256').update(pin).digest('hex')

describe('hashPin', () => {
	test('produces a salted scrypt hash, never the plain PIN or SHA-256', async () => {
		const h = await hashPin('1234')
		expect(h).toMatch(
			/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/
		)
		expect(h).not.toContain('1234')
		expect(h).not.toContain(sha256('1234'))
		expect(h.length).toBeLessThanOrEqual(255) // user_credentials.pin_hash
	})

	test('same PIN hashes differently each time (per-user salt)', async () => {
		expect(await hashPin('1234')).not.toBe(await hashPin('1234'))
	})
})

describe('verifyPin', () => {
	test('scrypt: right PIN ok, wrong PIN rejected, no rehash', async () => {
		const h = await hashPin('482913')
		expect(await verifyPin('482913', h)).toEqual({
			ok: true,
			needsRehash: false,
		})
		expect((await verifyPin('482914', h)).ok).toBe(false)
	})

	test('legacy SHA-256: right PIN ok AND flagged for rehash', async () => {
		expect(await verifyPin('1234', sha256('1234'))).toEqual({
			ok: true,
			needsRehash: true,
		})
		expect(
			await verifyPin('1234', sha256('1234').toUpperCase())
		).toEqual({ ok: true, needsRehash: true })
	})

	test('legacy SHA-256: wrong PIN rejected, no rehash', async () => {
		expect(await verifyPin('0000', sha256('1234'))).toEqual({
			ok: false,
			needsRehash: false,
		})
	})

	test('missing or malformed stored hash never verifies', async () => {
		expect((await verifyPin('1234', undefined)).ok).toBe(false)
		expect((await verifyPin('1234', '')).ok).toBe(false)
		expect((await verifyPin('1234', 'scrypt$garbage')).ok).toBe(
			false
		)
		expect((await verifyPin('1234', '1234')).ok).toBe(false)
	})
})

describe('isValidPin', () => {
	test.each(['1234', '12345', '123456'])('accepts %s', (pin) => {
		expect(isValidPin(pin)).toBe(true)
	})
	test.each(['123', '1234567', 'abcd', '12a4', ' 1234', '', null, 1234])(
		'rejects %p',
		(pin) => {
			expect(isValidPin(pin)).toBe(false)
		}
	)
})

describe('isLegacyHash', () => {
	test('recognises 64-hex SHA-256 only', async () => {
		expect(isLegacyHash(sha256('1'))).toBe(true)
		expect(isLegacyHash(await hashPin('1234'))).toBe(false)
	})
})
