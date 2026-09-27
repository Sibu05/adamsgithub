import { jest } from '@jest/globals'

const runMigrations = jest.fn(async () => {})
const getMigrations = jest.fn()
jest.unstable_mockModule('better-auth/db/migration', () => ({
	getMigrations,
}))

const { pending_better_auth_migrations, migrate_better_auth } =
	await import('./migrate_better_auth.js')

const options = { database: {} }

beforeEach(() => {
	runMigrations.mockClear()
	getMigrations.mockReset()
})

describe('pending_better_auth_migrations', () => {
	test('lists missing tables and columns without running anything', async () => {
		getMigrations.mockResolvedValue({
			toBeCreated: [
				{ table: 'user' },
				{ table: 'verification' },
			],
			toBeAdded: [
				{ table: 'session', fields: { ipAddress: {} } },
			],
			runMigrations,
		})
		expect(await pending_better_auth_migrations(options)).toEqual({
			tables: ['user', 'verification'],
			columns: ['session.ipAddress'],
		})
		expect(getMigrations).toHaveBeenCalledWith(options, {
			throwOnUnsafe: false,
		})
		expect(runMigrations).not.toHaveBeenCalled()
	})

	test('empty when everything exists', async () => {
		getMigrations.mockResolvedValue({
			toBeCreated: [],
			toBeAdded: [],
			runMigrations,
		})
		expect(await pending_better_auth_migrations(options)).toEqual({
			tables: [],
			columns: [],
		})
	})
})

describe('migrate_better_auth', () => {
	test('runs Better Auth’s own migration plan and reports what changed', async () => {
		getMigrations.mockResolvedValue({
			toBeCreated: [{ table: 'user' }, { table: 'account' }],
			toBeAdded: [],
			runMigrations,
		})
		expect(await migrate_better_auth(options)).toEqual({
			created: ['user', 'account'],
			added: [],
		})
		expect(runMigrations).toHaveBeenCalledTimes(1)
	})
})
