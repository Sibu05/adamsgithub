/**
 * In-memory failed-login limiter for username + PIN.
 *
 * Two buckets per failure, both over a sliding FAILURE_WINDOW_MS:
 *   - ip|username: MAX_FAILURES_PER_ACCOUNT, then LOCKOUT_MS lockout.
 *     Keyed with the IP too, so someone elsewhere can't lock a player out
 *     of their own account just by guessing wrong on purpose.
 *   - ip: MAX_FAILURES_PER_IP across all usernames, so one client can't
 *     spray guesses over many accounts.
 * A successful login clears the ip|username bucket.
 *
 * Per server process — with several backend instances each keeps its own
 * counts (still a hard cap per instance).
 */
export const FAILURE_WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT_MS = 15 * 60 * 1000
export const MAX_FAILURES_PER_ACCOUNT = 5
export const MAX_FAILURES_PER_IP = 20

export function createLoginLimiter({ now = () => Date.now() } = {}) {
	const buckets = new Map() // key -> { failures: number[], lockedUntil }

	function bucket(key) {
		let b = buckets.get(key)
		if (!b) {
			b = { failures: [], lockedUntil: 0 }
			buckets.set(key, b)
		}
		b.failures = b.failures.filter(
			(t) => now() - t < FAILURE_WINDOW_MS
		)
		return b
	}

	const keysFor = (ip, username) => [
		[
			`acct:${ip}|${String(username).toLowerCase()}`,
			MAX_FAILURES_PER_ACCOUNT,
		],
		[`ip:${ip}`, MAX_FAILURES_PER_IP],
	]

	return {
		/** ms until this ip+username may try again, or 0 if allowed now. */
		retryAfterMs(ip, username) {
			let wait = 0
			for (const [key] of keysFor(ip, username)) {
				const b = bucket(key)
				wait = Math.max(wait, b.lockedUntil - now())
			}
			return Math.max(0, wait)
		},

		recordFailure(ip, username) {
			for (const [key, max] of keysFor(ip, username)) {
				const b = bucket(key)
				b.failures.push(now())
				if (b.failures.length >= max) {
					b.lockedUntil = now() + LOCKOUT_MS
					b.failures = []
				}
			}
		},

		recordSuccess(ip, username) {
			buckets.delete(keysFor(ip, username)[0][0])
		},

		reset() {
			buckets.clear()
		},
	}
}
