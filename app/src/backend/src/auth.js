/**
 * Better Auth server configuration.
 * Adapted from feat/user-story-1-auth for integration into dev.
 *
 * Uses the shared mysql2 pool from utils/db.js instead of creating
 * a second pool — ensures consistent DB config across the entire app.
 */

import { betterAuth } from 'better-auth'
import { mysql2 } from 'better-auth/adapters/mysql2'
import pool from '../utils/db.js'

function buildSocialProviders() {
	const providers = {}
	if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
		providers.google = {
			clientId: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
		}
	}
	return providers
}

export const auth = betterAuth({
	database: mysql2(pool),
	baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
	secret: process.env.BETTER_AUTH_SECRET,
	appName: 'Adamas2Aurum',
	socialProviders: buildSocialProviders(),
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ user, url, token }) => {
			console.log(
				'\n========================================'
			)
			console.log('  PASSWORD RESET REQUEST')
			console.log('  User:  ' + user.email)
			console.log('  Token: ' + token)
			console.log('  URL:   ' + url)
			console.log(
				'========================================\n'
			)
		},
	},
	user: {
		deleteUser: { enabled: true },
	},
})
