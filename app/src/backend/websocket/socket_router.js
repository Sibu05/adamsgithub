import { battleWss } from './battle_socket.js'
import { spectateWss } from './spectate_socket.js'
import { abandon_stale_battles } from '../utils/battle.js'

let is_router_attached = false

export async function setup_websocket_router(server, session_middleware) {
	if (is_router_attached) {
		server.removeAllListeners('upgrade')
	}
	is_router_attached = true
	abandon_stale_battles()

	server.on('upgrade', (request, socket, head) => {
		if (
			socket._ws_handled ||
			socket.destroyed ||
			!socket.writable
		) {
			return
		}

		const { pathname } = new URL(
			request.url,
			`http://${request.headers.host}`
		)

		let targetWss = null
		if (pathname.startsWith('/ws/battle')) {
			targetWss = battleWss
		} else if (pathname.startsWith('/ws/spectate')) {
			targetWss = spectateWss
		}

		if (!targetWss) {
			socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
			socket.destroy()
			return
		}

		socket._ws_handled = true

		session_middleware(request, {}, () => {
			request.user = request.session?.user || null

			if (!request.user?.user_id) {
				socket.write(
					'HTTP/1.1 401 Unauthorized\r\n\r\n'
				)
				socket.destroy()
				return
			}

			// Guard in case socket closed during async session retrieval
			if (socket.destroyed || !socket.writable) {
				return
			}

			targetWss.handleUpgrade(request, socket, head, (ws) => {
				targetWss.emit('connection', ws, request)
			})
		})
	})
}
