/**
 * Better Auth table migration — creates/updates the `user`, `session`,
 * `account` and `verification` tables Better Auth needs (Google OAuth and
 * email sign-in). Better Auth does NOT create these on its own.
 *
 * Uses Better Auth's own migration planner (the same one
 * `npx @better-auth/cli migrate` runs), so the tables always match the
 * installed better-auth version. Additive and idempotent: missing tables
 * and columns are created, nothing is dropped.
 *
 * Run: `npm run db:migrate-auth` (root or app/src/backend). Runs against
 * whatever DB_* the backend .env points at — check before running.
 */
import { getMigrations } from 'better-auth/db/migration'
import { fileURLToPath } from 'url'

/**
 * Tables/columns Better Auth still needs. Read-only: never changes the DB.
 */
export async function pending_better_auth_migrations(options) {
	const { toBeCreated, toBeAdded } = await getMigrations(options, {
		throwOnUnsafe: false,
	})
	return {
		tables: toBeCreated.map((t) => t.table),
		columns: toBeAdded.flatMap((t) =>
			Object.keys(t.fields).map((f) => `${t.table}.${f}`)
		),
	}
}

export async function migrate_better_auth(options) {
	const { toBeCreated, toBeAdded, runMigrations } =
		await getMigrations(options)
	await runMigrations()
	return {
		created: toBeCreated.map((t) => t.table),
		added: toBeAdded.map((t) => t.table),
	}
}

// CLI entry: `node db/migrate_better_auth.js`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { auth } = await import('../src/auth.js')
	const { default: pool } = await import('../utils/db.js')
	try {
		const { created, added } = await migrate_better_auth(
			auth.options
		)
		console.log(
			created.length || added.length
				? `Better Auth migration done. Created: [${created.join(', ')}] Updated: [${added.join(', ')}]`
				: 'Better Auth tables already up to date.'
		)
		await pool.end()
		process.exit(0)
	} catch (err) {
		console.error('Better Auth migration failed:', err.message)
		process.exit(1)
	}
}
