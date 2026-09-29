import pool from './utils/db.js'
import { execute_sql_script } from './utils/sql_utils.js'

// Run with: npm run db:seed-wits
// Adds six published Wits-campus events with questions (db/seed-wits.sql)
// so procedural pop-ups have Wits content to copy. Additive and
// idempotent — unlike db:seed it truncates nothing and is safe to re-run.
// It writes to whatever DB_* in .env points at — check before running.

async function main() {
	console.log(
		`======\nSeeding Wits campus events into ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}\n======`
	)
	const ret = await execute_sql_script(pool, './db/seed-wits.sql')
	if (ret.ok === false) throw ret.error
	const [[counts]] = await pool.query(
		`SELECT COUNT(DISTINCT e.event_id) AS events, COUNT(tq.question_id) AS questions
		   FROM events e
		   JOIN trivia_questions tq ON tq.event_id = e.event_id
		  WHERE e.is_procedural = FALSE
		    AND e.title IN ('Great Hall', 'William Cullen Library', 'Origins Centre',
		                    'Wits Science Stadium', 'Johannesburg Planetarium', 'The Matrix')`
	)
	console.log(
		`======\nDone: ${counts.events} Wits events, ${counts.questions} questions.\n======`
	)
	await pool.end()
	process.exit(0)
}

main().catch((err) => {
	console.error('Wits seeding failed:', err.message)
	process.exit(1)
})
