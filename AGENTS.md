# AGENTS.md — Ledvance SMART+ WiFi Raycast extension

Instructions for AI coding agents (and humans) working in this repository.

## What this extension is

A Raycast extension that controls a **Ledvance SMART+ WiFi Planon Plus** panel (and, per
assumption, the Tuya Smart+ RGBTW bulb family sharing the same DP schema) **locally** via the
Tuya local protocol v3.3 on TCP 6668. No cloud, no vendor app.

Two commands:

- **Control Panel** (`src/index.tsx`) — status view and all controls: power, brightness, colour
  temperature, colour (grid picker), mode switching (⌃C / ⌃W).
- **Scenes** (`src/scenes.tsx`) — static presets (Night / Read / Meeting) applied as single
  writes; animated scenes (Rainbow / Leisure) run as timed hue-cycling loops **inside the
  Scenes view's process**, until stopped, superseded, or the light power is cut.

## The single non-negotiable architecture rule

**`buildUpdateDps(known, update)` in `src/dpMapping.ts` is the only place that turns user intent
into DP writes, and it always produces ONE full-state write.**

Every command/control fetches the known state, merges the user's change over it, and sends the
complete set `{ 20: power, 21: mode, 22: white brightness, 23: CCT, 24: colour incl. V=brightness }`.
Do not reintroduce per-carrier inference, context parameters, or partial writes. The tests in
`dpMapping.test.ts` and `dpMapping.snapshot.test.ts` pin this contract — if a proposed change
makes one fail, the panel behaviour must be re-verified before shipping.

## Firmware facts (hardware-verified; do not "simplify" them away)

- **Brightness carrier is mode-dependent**: DP 22 in white mode; the **V component of DP 24** in
  colour mode. The builder writes both consistently in every colour write (DP 22 re-carried).
- **The panel's DP 21 mode report lies**: it often claims `white` while the colour renderer is
  visibly active. Never trust it to decide write strategy — the Control Panel tracks the
  effective mode from its own writes (in-memory, view lifetime).
- **A colour update implies colour mode** (like the vendor app).
- **The panel never acks commands** (no sequenceN echo): writes are fire-and-forget; status
  queries work only on a **fresh connection** (tuyapi `refresh({ requestedDPS: [20..24] })`) —
  a bare query answers DP 20 only, and a stale socket never answers at all.
- **Transient `Err 914`**: retry up to 3× with ~2 s pause (status/sane writes only; animation
  frames deliberately not retried).
- **No `process.exit(0)`**: Raycast runs commands in worker threads; `process.exit` kills the
  worker ("Worker exited" error). `shutdown()` disconnects and lets the promise resolve.
- **Tuyapi `set()` shape**: `{ multiple: true, data: <dpsMap> }` — data is the map itself.

## Scenes specifics

- Pacing: 120 hue steps × 150 ms ≈ 18 s per hue revolution; full write per frame, no echo
  awaiting, frames not retried.
- Stop mechanics: the stop-token file (`utils.stopFlagPath()`, under `os.tmpdir()`) holds a
  token; each scene start rewrites it and a running loop exits as soon as the file no longer
  contains *its* token. Race-free by token identity, not timing.
- Animated loops live in the Scenes view's process: closing that Raycast window ends the loop.

## Known limits (accepted, do not "fix" silently)

- External changes (vendor app, wall button) between a status fetch and the next write are
  overwritten by the full-state write — inherent to the state-based design, same as the app.
- Colour and CCT cannot render simultaneously (one light engine, two renderers). The vendor app
  does the same; the extension keeps both values stored and re-applies them per mode.
- The stored effective mode is view-lifetime; reopening the Control Panel re-seeds from the
  (possibly wrong) DP 21 report until the first write.

## Development

```bash
npm install        # deps (pnpm also fine; package-lock is npm)
npm run dev        # ray develop — live-test against the panel
npm run typecheck  # tsc --noEmit
npm run test       # vitest (includes typecheck of tests)
npm run lint       # ray lint (author field must be a registered Raycast store username)
```

- **Do not add runtime dependencies** beyond `@raycast/api`, `react`, `tuyapi`.
- File layout is load-bearing: Raycast resolves **each manifest command to `src/<name>.tsx`** and
  treats every `src/*.{ts,tsx}` as an entry-point candidate. A data module sharing a name stem
  with a command (`scenes.ts` vs `scenes.tsx`) breaks the build — keep data modules disjointly
  named (`sceneData.ts`).
- Never commit `.env` (none in use — configuration is Raycast preferences; `TUYA_KEY` is a
  credential). Never log the key.
- Commit style: Conventional Commits with scope, DCO sign-off (`git commit -s`).

## Testing philosophy

29 vitest tests: value mappings (percent ↔ DP, Kelvin ↔ DP, RGB ↔ HSV hex), the full-state merge
contract, and snapshots of every user action from realistic known states. The snapshots ARE the
verified hardware behaviour — extend them with a new state/action only after checking the panel.
