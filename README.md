# Combat animator for Roblox

Describe a move, get an R15 animation, preview it on a 3D rig, and send it to Roblox Studio with one click.

## Run it

```sh
npm install
cp .env.example .env     # add GEMINI_API_KEY (or the LLM_* settings)
npm start                # http://localhost:3000
npm test
```

`MONGODB_URI` is optional. Without it, everything is kept in memory (resets on restart). On Railway set
`MONGODB_URI` and your API key; the app reads `PORT` itself.

## Studio plugin

1. Save `plugin/AnimBridge.server.lua` into Studio's Plugins folder (Plugins tab > Plugins Folder), restart Studio.
2. Open the AnimBridge window, enter your server URL (e.g. `https://your-app.up.railway.app`), and the 6-letter code shown in the web app, then press Link.
3. Select your R15 rig, press **Apply to Studio** in the web app. The clip lands in `Rig > AnimSaves`; open the Animation Editor and load it.

No plugin? Use **.rbxmx** (Studio: Insert from File) or **Copy Luau** (paste into the Command Bar with the rig selected).

## What happens to the model's answer (`src/core/polish.js`)

1. Joint limits from the real R15 rig; unknown joints dropped.
2. Overlapping action: outer joints trail the hips by a few frames.
3. Easing converted to how Roblox stores it (the pose that *starts* a segment decides the curve), using CubicV2
   because the legacy Cubic style runs reversed.
4. Big turns are cut into steps of at most 120 degrees, since Roblox always blends the short way (so a 360 spin works).
5. Grounding: the body is lowered or lifted so the lowest foot touches the floor on every key and between keys.
   Keys marked `"air": true` (jumps, flips) are left alone.
6. Motion flow: keys a joint passes through get pass-through easing instead of stopping at every key.
7. Loops end exactly where they start.
8. Checks (shown in the UI, **Ask the AI to fix this** sends them back): feet in the floor, hands inside the body,
   joints that snap, loops that pop.

The preview uses the same maths (`src/core/sample.js`, served to the browser at `/core`), so what you see is what
Studio plays: real joint offsets, Roblox's easing curves and its rotation blending.

## Layout

```
server.js            API + static files (createApp() is testable)
src/llm.js           Gemini / OpenAI-compatible calls, timeouts, retries, fallback model
src/store.js         MongoDB or in-memory storage
src/prompt.js        system prompt
src/core/            rig, sampling, polish, export (shared by server, browser and tests)
public/              web app (Three.js is served from node_modules, no CDN)
plugin/              Studio plugin
```

Rig data and maths are adapted from [OpenRig Studio](https://github.com/hildlabs/openrig-studio) (MIT, see NOTICE).

## Animation quality pipeline

`polish()` (src/core/polish.js): normalise → joint limits → phase-aware overlap lag → Roblox easing → spins → loop closing → grounding → **hand/foot IK targets** (analytic two-bone IK with poles) → motion flow → **overshoot + arc resampling** → foot lock (pivot-aware, blended, knee floor) → checks (body, arm-leg and leg-leg clipping).

Optional key fields the model can send: `phase` (`windup | strike | impact | followthrough | recovery | pass`) and `targets` (`RightHand | LeftHand | RightFoot | LeftFoot` with `pos` and optional `pole`, character space: x right, y up, z backwards). After `polish`, the server runs a silent auto-repair (`src/repair.js`): hand push-out via Hand IK, then at most one model "fix" pass.

Models: `GEMINI_MODEL` writes animations, `GEMINI_FIX_MODEL` does the repair pass, `GEMINI_FALLBACK_MODEL` is the backup (see `.env.example`; `LLM_MODEL` / `LLM_FIX_MODEL` / `LLM_FALLBACK_MODEL` for OpenAI-style providers).
