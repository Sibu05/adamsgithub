import {
	createLoginLimiter,
	FAILURE_WINDOW_MS,
	LOCKOUT_MS,
	MAX_FAILURES_PER_ACCOUNT,
	MAX_FAILURES_PER_IP,
} from './login_limiter.js'

function limiterAt(start = 0) {
	const clock = { t: start }
	return { clock, limiter: createLoginLimiter({ now: () => clock.t }) }
}

describe('login limiter', () => {
	test('locks an ip+username after MAX_FAILURES_PER_ACCOUNT failures', () => {
		const { limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i++) {
			limiter.recordFailure('1.1.1.1', 'thandi')
			expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(
				0
			)
		}
		limiter.recordFailure('1.1.1.1', 'thandi')
		expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(
			LOCKOUT_MS
		)
	})

	test('username is case-insensitive', () => {
		const { limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++)
			limiter.recordFailure('1.1.1.1', 'Thandi')
		expect(
			limiter.retryAfterMs('1.1.1.1', 'THANDI')
		).toBeGreaterThan(0)
	})

	test('someone on another IP cannot lock the real player out', () => {
		const { limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++)
			limiter.recordFailure('6.6.6.6', 'thandi')
		expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(0)
	})

	test('lockout expires after LOCKOUT_MS', () => {
		const { clock, limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++)
			limiter.recordFailure('1.1.1.1', 'thandi')
		clock.t += LOCKOUT_MS
		expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(0)
	})

	test('failures older than the window are forgotten', () => {
		const { clock, limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i++)
			limiter.recordFailure('1.1.1.1', 'thandi')
		clock.t += FAILURE_WINDOW_MS
		limiter.recordFailure('1.1.1.1', 'thandi')
		expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(0)
	})

	test('a successful login clears that account’s failures', () => {
		const { limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i++)
			limiter.recordFailure('1.1.1.1', 'thandi')
		limiter.recordSuccess('1.1.1.1', 'thandi')
		limiter.recordFailure('1.1.1.1', 'thandi')
		expect(limiter.retryAfterMs('1.1.1.1', 'thandi')).toBe(0)
	})

	test('one IP spraying many usernames is locked after MAX_FAILURES_PER_IP', () => {
		const { limiter } = limiterAt()
		for (let i = 0; i < MAX_FAILURES_PER_IP; i++)
			limiter.recordFailure('6.6.6.6', `user${i}`)
		expect(limiter.retryAfterMs('6.6.6.6', 'someone-new')).toBe(
			LOCKOUT_MS
		)
		expect(limiter.retryAfterMs('1.1.1.1', 'someone-new')).toBe(0)
	})
})
