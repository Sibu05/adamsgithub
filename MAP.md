# Wits Quest — Map System

Pokémon GO-style live world map for the Wits Quest campus game (University
of the Witwatersrand, Braamfontein). Players roam a gamified world map;
tappable event stops live at Wits; challenge attempts are gated to players
physically on campus.

## Architecture

- **Renderer:** MapLibre GL JS (CDN, v3.6.2), no API key.
- **Basemap:** CartoDB Voyager **vector** tiles (whole world, live OSM
  data), restyled in code to a PoGO look — green base, parks, water, muted
  extruded buildings, asphalt roads with solid yellow edge lines, zero
  street-name/POI labels. All gameplay information lives on markers, never
  in the tiles.
- **Single source of style truth:** `app/src/frontend/js/campus-style.js`
  (`createCampusStyle()`, camera constants, geofence bounds/helpers,
  day/night theme engine). All map pages import from it.

## Pages

| Page          | File                                                  | Role                                            |
| ------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Main game map | `app/src/frontend/index.html` + `js/main.js`          | GPS avatar, stops, geofence, trivia modals, HUD |
| 2D preview    | `app/src/frontend/pages/map.html`                     | World overview + event pins, no GPS             |
| Events        | `app/src/frontend/pages/events.html` + `js/events.js` | Sidebar list, range pills, challenge/QR flow    |

## Data flow (no static campus file)

- `campus.geojson` is **retired as a render source** — neither copy
  (`app/src/frontend/public/`, `app/src/backend/`) is fetched or drawn.
  Kept for reference/future use only.
- **Event stops:** coordinates + metadata come from the backend
  (`GET /api/events`), with a hardcoded 6-stop fallback when offline.
- **Off-campus fact stops:** queried live from the already-loaded vector
  tiles (`poi` layer, name required, max 12 in view, zoom ≥ 15.5).
- **Proximity radii:** GeoJSON built at runtime from event coordinates —
  the only GeoJSON the client creates.

## Gameplay systems

- **Player avatar:** continuous GPS `watchPosition`, blue dot + accuracy
  circle, compass/GPS heading wedge, idle/walk animation, fading breadcrumb
  trail. Camera follow mode centers on the player as they move, with drag-to-free-look
  and 🎯 recenter.
- **Geofence:** rectangular bbox around Braamfontein
  (lon 28.017–28.050, lat −26.198––26.173) decides on/off-campus.
  Off-campus players browse freely with an info banner; tapping a stop
  shows _"You need to be on Wits campus"_ instead of starting trivia.
  (Known limitation: bbox, not a true campus polygon.)
- **Day/night:** real-time theme blended from the device clock (dark navy
  night palette, dimmed fog/clouds, smooth dawn/dusk transitions),
  re-applied every 60s. Covered by `daynight.test.js`.
- **Camera:** street-level lock (zoom 17–20, pitch 55–70°), PoGO-style
  follow with drag-to-free-look, 🎯 recenter, idle pull-back to campus.

## Recent updates & fixes

### 1. Live GPS Player Tracker & Proximity Overhaul (`events.js`)

- **Real-Time Dynamic Proximity:** Previously, `events.js` evaluated stop proximity once on load, locking popups into a stale "Walk closer" state even after the player walked directly to a landmark. Proximity is now updated dynamically on every continuous GPS tick via `refreshAllStopsProximity()`.
- **Dynamic Popup Generation:** Stop popups are re-evaluated and generated dynamically upon click/tap via `openStopPopup()`, ensuring the "⚡ Attempt Challenge" button renders immediately whenever a player is in range.
- **Camera Follow & Auto-Centering:** On the initial GPS fix, the camera automatically glides to the player's position so markers do not spawn off-screen. Follow mode smoothly tracks player movements until the user manually pans, and re-engages on tapping the recenter button (`btn-recenter`).
- **Eliminated 10-Second Freezes:** `loadEvents()` now prioritizes cached coordinates from the continuous GPS watch stream, avoiding redundant 10-second blocking `getCurrentPosition` calls. In `_challenge()`, if live GPS accuracy is $\le 50\text{m}$, the attempt starts instantly without an extra 10-second lookup.
- **Error Handling & Resource Cleanup:** Added explicit feedback when geolocation permissions are blocked, and registered `beforeunload` cleanup to clear the GPS watch.

### 2. Unified Dual-Session Logout System (`auth-helpers.js`, all pages)

- **Dual-Session Termination:** Centralized `logout()` in `auth-helpers.js` to concurrently invalidate both `express-session` (`POST /api/auth/logout`) and Better Auth Google OAuth (`POST /api/auth/sign-out`) via `Promise.allSettled`.
- **Prevented OAuth Re-Authentication Loop:** Resolved the issue where Google OAuth cookies remained active on non-landing pages (`events.html`, `collection.html`, `battle.html`, `console.html`), which previously triggered automatic re-login on the next request.
- **Fixed Leaderboard Logout:** Fixed missing click listener on `pages/leaderboard.html` and unified logout across all application pages.
- **Safety & Error Tolerance:** Wrapped logout execution in `try...finally` to ensure the avatar menu is cleaned up and navigation redirects to `/` even under offline or degraded network conditions.

## Verification

- `npm run test:ci` (`node --experimental-vm-modules node_modules/.bin/jest --ci --coverage`): **19 passed test suites, 207 passed tests** — `All 83.43%` / `frontend/js 91.05%` / `backend/routes 80.31%` (was 7/59 in Sprint 1). Frontend map suites: `campus-style 94.9%` (`isInsideCampus`, `createCampusStyle`, `applyChromeTheme`), `geolocation`, `daynight`.
- `npm run format:check`: 100% compliant with Prettier formatting.
- **Canonical docs now published at:** `Adamas2Aurum-Documentation/docs/implementation/map-system.md` (Docusaurus, includes this file + updated coverage). This `MAP.md` kept as app-repo quick reference.

## AI Declaration

This update and accompanying documentation were developed with the assistance of AI tooling (Antigravity + Muse Spark via Opencode). AI was used to diagnose and resolve session termination bugs, audit and overhaul the real-time GPS tracking and proximity systems, implement automated unit tests for auth helpers, campus-style, and coverage badges, and format codebase assets. All contributions were verified against the project's automated test suite (`npm run test:ci`) and code style standards.
