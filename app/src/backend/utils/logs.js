const MAX_LOG_ENTRIES = 250
export const log_buffer = []

const rawLog = console.log
const rawWarn = console.warn
const rawError = console.error

function captureLog(type, args) {
	const timestamp = new Date().toISOString()
	const formattedArgs = args
		.map((arg) =>
			typeof arg === 'object' ? JSON.stringify(arg) : arg
		)
		.join(' ')

	log_buffer.push(
		`[${timestamp}] [${type.toUpperCase()}]: ${formattedArgs}`
	)

	// Maintain sliding window size
	if (log_buffer.length > MAX_LOG_ENTRIES) {
		log_buffer.shift()
	}
}

console.log = (...args) => {
	captureLog('info', args)
	rawLog.apply(console, args)
}

console.warn = (...args) => {
	captureLog('warn', args)
	rawWarn.apply(console, args)
}

console.error = (...args) => {
	captureLog('error', args)
	rawError.apply(console, args)
}
