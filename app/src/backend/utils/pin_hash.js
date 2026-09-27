import crypto from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(crypto.scrypt)

// scrypt cost parameters, stored in every hash so they can be raised
// later without breaking existing PINs.
const N = 16384
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_BYTES = 16

// 4–6 digits: short enough to type on a phone mid-game, and scrypt plus
// the login limiter make brute-forcing it impractical.
export const PIN_PATTERN = /^\d{4,6}$/

export function isValidPin(pin) {
	return typeof pin === 'string' && PIN_PATTERN.test(pin)
}

// Hashes written before scrypt: unsalted SHA-256, 64 hex chars.
export function isLegacyHash(stored) {
	return /^[0-9a-f]{64}$/i.test(String(stored))
}

function legacySha256(pin) {
	return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

/** "scrypt$N$r$p$<salt hex>$<hash hex>" with a fresh random salt. */
export async function hashPin(pin) {
	const salt = crypto.randomBytes(SALT_BYTES)
	const key = await scrypt(String(pin), salt, KEY_LEN, { N, r: R, p: P })
	return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`
}

function safeEqualHex(a, b) {
	const x = Buffer.from(String(a).toLowerCase(), 'hex')
	const y = Buffer.from(String(b).toLowerCase(), 'hex')
	return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * Checks a PIN against a stored hash of either format.
 * @returns {{ ok: boolean, needsRehash: boolean }} needsRehash is true
 *   when the PIN matched a legacy SHA-256 hash and should be upgraded.
 */
export async function verifyPin(pin, stored) {
	if (!stored) return { ok: false, needsRehash: false }

	if (isLegacyHash(stored)) {
		const ok = safeEqualHex(legacySha256(pin), stored)
		return { ok, needsRehash: ok }
	}

	const parts = String(stored).split('$')
	if (parts.length !== 6 || parts[0] !== 'scrypt')
		return { ok: false, needsRehash: false }
	const [, n, r, p, saltHex, hashHex] = parts
	const key = await scrypt(
		String(pin),
		Buffer.from(saltHex, 'hex'),
		hashHex.length / 2,
		{ N: Number(n), r: Number(r), p: Number(p) }
	)
	return {
		ok: safeEqualHex(key.toString('hex'), hashHex),
		needsRehash: false,
	}
}
