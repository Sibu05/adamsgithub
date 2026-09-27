import 'dotenv/config'
import mysql from 'mysql2/promise'
import path from 'path'
import fs from 'fs'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const sslConfig = () => {
	if (process.env.DB_SSL !== 'true') return false

	// Render — cert stored as base64 env var
	if (process.env.CA_CERT_BASE64) {
		return {
			ca: Buffer.from(
				process.env.CA_CERT_BASE64,
				'base64'
			).toString('utf-8'),
			rejectUnauthorized: true,
		}
	}

	// local — cert read from file
	return {
		ca: fs.readFileSync(
			path.join(__dirname, '..', 'certs', 'ca.pem')
		),
		rejectUnauthorized: true,
	}
}

const pool = mysql.createPool({
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 8024,
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'test',
	database: process.env.DB_NAME || 'testdb',
	ssl: sslConfig(),
	// Every DATETIME column holds UTC (NOW()/UTC_TIMESTAMP() on a UTC DB
	// server, toUtcDatetime() in events/campaigns, toMysqlDatetime() in
	// placement). Without this, mysql2 reads them back as the app
	// server's LOCAL time, which is off by 2 h on a SAST laptop.
	timezone: 'Z',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
})

if (process.env.LOG_DB === 'true' && process.env.VERBOSE_LOG_DB === 'true') {
	const originalQuery = pool.query.bind(pool)
	const originalExecute = pool.execute.bind(pool)

	pool.query = function (...args) {
		const sql = args[0]
		const values = args[1]
		console.log(
			`[DB Query] Running: ${sql}`,
			values ? `with values: ${JSON.stringify(values)}` : ''
		)

		return originalQuery(...args)
	}

	pool.execute = function (...args) {
		const sql = args[0]
		const values = args[1]
		console.log(
			`[DB Execute] Running: ${sql}`,
			values ? `with values: ${JSON.stringify(values)}` : ''
		)

		return originalExecute(...args)
	}
}

export default pool
