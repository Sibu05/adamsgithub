/**
 * qr-scanner.js — Frontend QR fallback for low-accuracy GPS
 *
 * Exported functions:
 *   - get_player_location_with_fallback(eventId) — drop-in replacement
 *     for get_player_location(). Returns the same { lat, lng } shape
 *     but also triggers the QR flow when accuracy is too poor.
 *   - check_accuracy_and_maybe_scan(eventId, accuracy) — call this
 *     after getting a location if you already have coords but accuracy
 *     is poor.
 *
 * Usage in events.js / main.js:
 *   import { get_location_for_challenge } from './qr-scanner.js'
 *   const result = await get_location_for_challenge(eventId)
 *   // result is one of:
 *   //   { mode: 'gps', lat, lng, accuracy }
 *   //   { mode: 'qr',  qr_verified: true, location_check_id }
 *   //   null (user cancelled)
 */

import { API_BASE } from './constants.js'

const GPS_ACCURACY_THRESHOLD_M = 50 // must match backend qr.js

// ── Public API ────────────────────────────────────────────────

/**
 * Gets the player's location. If GPS accuracy is too poor,
 * automatically shows the QR scanner overlay instead.
 *
 * @param {number} eventId
 * @returns {Promise<{mode:'gps',lat,lng,accuracy}|{mode:'qr',qr_verified:true,location_check_id}|null>}
 */
export async function get_location_for_challenge(eventId) {
	return new Promise((resolve) => {
		if (!navigator.geolocation) {
			// No geolocation at all — go straight to QR
			showQrScanner(eventId, resolve)
			return
		}

		navigator.geolocation.getCurrentPosition(
			(pos) => {
				const {
					latitude: lat,
					longitude: lng,
					accuracy,
				} = pos.coords

				if (accuracy > GPS_ACCURACY_THRESHOLD_M) {
					// GPS too poor — trigger QR fallback
					showQrScanner(eventId, resolve, {
						reported_accuracy:
							Math.round(accuracy),
					})
				} else {
					resolve({
						mode: 'gps',
						lat,
						lng,
						accuracy,
					})
				}
			},
			() => {
				// GPS failed entirely — try QR
				showQrScanner(eventId, resolve)
			},
			{ enableHighAccuracy: true, timeout: 10000 }
		)
	})
}

// ── QR Scanner overlay ────────────────────────────────────────

let jsQrLoaded = false

async function loadJsQr() {
	if (jsQrLoaded || window.jsQR) {
		jsQrLoaded = true
		return
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement('script')
		script.src =
			'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js'
		script.onload = () => {
			jsQrLoaded = true
			resolve()
		}
		script.onerror = reject
		document.head.appendChild(script)
	})
}

function showQrScanner(eventId, resolve, opts = {}) {
	// Remove any existing overlay
	document.getElementById('qr-overlay')?.remove()

	const overlay = document.createElement('div')
	overlay.id = 'qr-overlay'
	overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.85);
        display:flex;flex-direction:column;align-items:center;
        justify-content:center;z-index:20000;
        font-family:var(--font-body,'Segoe UI',sans-serif);
        padding:1.5rem;
    `

	const accuracyNote = opts.reported_accuracy
		? `<p style="color:#fbbf24;font-size:0.8rem;margin:0 0 1rem;">
             ⚠️ GPS accuracy (${opts.reported_accuracy}m) is too poor for verification.
           </p>`
		: `<p style="color:#fbbf24;font-size:0.8rem;margin:0 0 1rem;">
             ⚠️ GPS unavailable at this location.
           </p>`

	overlay.innerHTML = `
        <div style="
            background:#fff;border-radius:12px;
            padding:1.5rem;max-width:360px;width:100%;
            text-align:center;
        ">
            <div style="font-weight:700;font-size:1.05rem;color:#1e293b;margin-bottom:0.5rem;">
                📷 Scan Location QR Code
            </div>
            ${accuracyNote}
            <p style="font-size:0.82rem;color:#475569;margin:0 0 1rem;">
                Point your camera at the QR code posted at this campus location to verify your presence.
            </p>

            <!-- Camera feed -->
            <div style="position:relative;border-radius:8px;overflow:hidden;background:#000;margin-bottom:1rem;">
                <video id="qr-video" style="width:100%;display:block;" playsinline muted></video>
                <canvas id="qr-canvas" style="display:none;"></canvas>
                <!-- Scan frame overlay -->
                <div style="
                    position:absolute;inset:0;
                    border:3px solid transparent;
                    box-shadow:inset 0 0 0 3px rgba(167,139,250,0.8);
                    border-radius:8px;pointer-events:none;">
                </div>
                <div id="qr-scan-line" style="
                    position:absolute;left:0;right:0;height:2px;
                    background:linear-gradient(90deg,transparent,#a78bfa,transparent);
                    animation:qr-scan 2s linear infinite;top:20%;
                "></div>
            </div>

            <div id="qr-status" style="font-size:0.82rem;color:#64748b;margin-bottom:1rem;min-height:1.2em;">
                Starting camera…
            </div>

            <button id="qr-cancel" style="
                background:none;border:1px solid #cbd5e1;border-radius:6px;
                padding:0.4rem 1rem;font-size:0.82rem;color:#64748b;cursor:pointer;
            ">Cancel</button>
        </div>

        <style>
            @keyframes qr-scan {
                0%   { top: 10%; }
                50%  { top: 80%; }
                100% { top: 10%; }
            }
        </style>
    `

	document.body.appendChild(overlay)

	const videoEl = overlay.querySelector('#qr-video')
	const canvasEl = overlay.querySelector('#qr-canvas')
	const statusEl = overlay.querySelector('#qr-status')
	const cancelBtn = overlay.querySelector('#qr-cancel')

	let stream = null
	let animFrame = null
	let done = false

	function cleanup() {
		if (animFrame) cancelAnimationFrame(animFrame)
		if (stream) stream.getTracks().forEach((t) => t.stop())
		overlay.remove()
	}

	cancelBtn.addEventListener('click', () => {
		if (done) return
		done = true
		cleanup()
		resolve(null) // user cancelled
	})

	// Start camera + jsQR
	async function startScanner() {
		try {
			await loadJsQr()
		} catch {
			statusEl.textContent =
				'Could not load QR library. Check your connection.'
			return
		}

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
			})
			videoEl.srcObject = stream
			await videoEl.play()
			statusEl.textContent =
				'Scanning… hold the QR code steady.'
			scanFrame()
		} catch (err) {
			statusEl.textContent = `Camera error: ${err.message}`
		}
	}

	function scanFrame() {
		if (done) return

		if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
			canvasEl.width = videoEl.videoWidth
			canvasEl.height = videoEl.videoHeight
			const ctx = canvasEl.getContext('2d')
			ctx.drawImage(videoEl, 0, 0)
			const imageData = ctx.getImageData(
				0,
				0,
				canvasEl.width,
				canvasEl.height
			)
			const code = window.jsQR(
				imageData.data,
				imageData.width,
				imageData.height,
				{
					inversionAttempts: 'dontInvert',
				}
			)

			if (code) {
				handleScannedCode(code.data)
				return
			}
		}

		animFrame = requestAnimationFrame(scanFrame)
	}

	async function handleScannedCode(raw) {
		if (done) return
		done = true

		// Extract token — the QR encodes a URL like:
		// https://localhost:3000/pages/events.html?qr=<token>
		// but we also handle a raw token string directly
		let token = raw
		try {
			const url = new URL(raw)
			token = url.searchParams.get('qr') || raw
		} catch {
			// raw wasn't a URL — treat it as the token itself
		}

		statusEl.textContent = 'QR detected — verifying…'

		try {
			const res = await fetch(
				`${API_BASE}/api/events/${eventId}/verify-qr`,
				{
					method: 'POST',
					credentials: 'include',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({ token }),
				}
			)
			const data = await res.json()

			if (!res.ok || !data.verified) {
				statusEl.textContent =
					data.error ||
					'QR verification failed. Try again.'
				done = false // allow retry
				animFrame = requestAnimationFrame(scanFrame)
				return
			}

			statusEl.textContent = '✓ Verified!'
			setTimeout(() => {
				cleanup()
				resolve({
					mode: 'qr',
					qr_verified: true,
					location_check_id:
						data.location_check_id,
				})
			}, 600)
		} catch {
			statusEl.textContent = 'Network error. Try again.'
			done = false
			animFrame = requestAnimationFrame(scanFrame)
		}
	}

	startScanner()
}
