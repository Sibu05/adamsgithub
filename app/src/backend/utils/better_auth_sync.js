const USER_COLUMNS = 'user_id, name, email, avatar_url, points'

export const PIN_ACCOUNT_CONFLICT =
	'This email is already used by a username + PIN account, so it can’t be signed into with Google. Log in with that username and PIN instead.'

/**
 * Maps a Better Auth (Google) user onto our `users` table.
 *
 * Matched by the provider account id (users.provider_id =
 * "betterauth:<id>"), NOT by email alone — username + PIN accounts could
 * pick any username, including someone else's email address, and used to
 * be handed that person's Google login.
 *
 * Email fallback: an existing row with the same email is linked (its
 * provider_id set to this Google account) ONLY if it has no PIN
 * credentials. A row with a PIN is never auto-linked — the Google login
 * is refused instead and the PIN account keeps working as before.
 *
 * @returns {Promise<{ user: object } | { conflict: string }>}
 */
export async function resolve_better_auth_user(db, baUser) {
	const providerId = `betterauth:${baUser.id}`

	const [byProvider] = await db.query(
		`SELECT ${USER_COLUMNS} FROM users WHERE provider_id = ?`,
		[providerId]
	)
	if (byProvider.length) return { user: byProvider[0] }

	const [byEmail] = await db.query(
		`SELECT u.user_id,
		        EXISTS (SELECT 1 FROM user_credentials c WHERE c.user_id = u.user_id) AS has_pin
		   FROM users u
		  WHERE u.email = ?`,
		[baUser.email]
	)
	if (byEmail.length) {
		const existing = byEmail[0]
		if (Number(existing.has_pin))
			return { conflict: PIN_ACCOUNT_CONFLICT }

		await db.query(
			'UPDATE users SET provider_id = ? WHERE user_id = ?',
			[providerId, existing.user_id]
		)
		const [linked] = await db.query(
			`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`,
			[existing.user_id]
		)
		return { user: linked[0] }
	}

	// First-time Google user — sync into our users table.
	const [result] = await db.query(
		`INSERT INTO users (provider_id, email, name, avatar_url, points)
		 VALUES (?, ?, ?, ?, 0)`,
		[providerId, baUser.email, baUser.name, baUser.image]
	)
	const [created] = await db.query(
		`SELECT ${USER_COLUMNS} FROM users WHERE user_id = ?`,
		[result.insertId]
	)
	return { user: created[0] }
}
