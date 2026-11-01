# QoE-Net Labs

**Subjective and Objective Quality of Experience (QoE) Framework for Video Conferencing Services with Intermittent Network Connectivity**

A final-year CSE research prototype. It runs a real two-participant WebRTC video call, samples `RTCPeerConnection.getStats()` every 5 seconds, estimates QoE with a documented heuristic, applies an audio > teacher video > screen-share priority policy, and exports the collected measurements as a 28-column CSV.

> Nothing is simulated. Metrics a browser does not report are exported as empty fields. Quality scores are **estimates**, not subjective ratings.

## Features
- Two-party video call by room ID: mic, camera and screen-share controls, connection status, visible errors
- Live dashboard: RTT, jitter, packet loss, bitrates, FPS, dropped frames, freezes, estimated QoE, network condition
- Network condition classes: Normal / Degraded / Poor / Intermittent (configurable thresholds)
- Priority policy applied with `RTCRtpSender.setParameters()` and `MediaStreamTrack.enabled`
- Experiments page with a manual scenario log, CSV export, experiment summary, session history (FastAPI + optional MongoDB)

## Quick start
Requires Python 3.9+ and a modern desktop browser (Chrome or Edge recommended).
```bash
git clone https://github.com/<your-username>/qoe-net-labs.git
cd qoe-net-labs
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
Open **http://localhost:8000** in two browser windows, join the same Room ID, and allow camera and microphone.
Open the site through the server. Opening `static/index.html` directly, VS Code Live Server or GitHub Pages cannot work, because the call needs the `/api` backend for signaling.

## Deploying (for a live demo link)
GitHub hosts the code, but GitHub Pages cannot run the Python backend. Deploy the repository to a host such as Render, Railway or Fly.io:
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Optional environment variables: `MONGO_URL`, `DB_NAME` (never commit these)

The host provides HTTPS, which camera access needs. For participants on different networks add a TURN server in `static/js/config.js` (`iceServers`).

## Troubleshooting
| Message | Cause and fix |
|---|---|
| Signaling server unreachable (WebSocket and HTTP polling both failed) | The page is not served by the FastAPI server, or the server is stopped. Run `uvicorn main:app --port 8000` and open `http://localhost:8000`. Check that `http://localhost:8000/api/sessions` shows `[]`. |
| Camera/microphone API unavailable | Use `https://` or `http://localhost`. |
| WebRTC connection failed | Firewall or strict NAT. Add a TURN server to `config.js`. |
| This room already has two participants | Choose a different Room ID. |

## Folder structure
```
main.py              FastAPI: WebSocket signaling /api/ws/{room}, HTTP polling fallback, session history API, static hosting
requirements.txt
static/
  index.html         Home, Conference, Dashboard, Experiments, History, About (hash routing)
  css/style.css
  js/config.js       ALL tunable thresholds, QoE weights, priority-policy presets, ICE servers
  js/data.js         28-column CSV schema, row validation, CSV export (pure functions)
  js/qoe.js          QoE heuristic (+ plug-in point for a trained model), network classification
  js/rtc.js          Media, signaling, mic/camera/screen controls
  js/monitor.js      5 s getStats() sampler, deltas, interruptions, priority policy, summary
  js/ui.js           Pages, charts, experiments log, history, about
```

## Run
```
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
Open `http://localhost:8000` in two browser windows (or two devices over HTTPS). Camera/microphone need HTTPS or localhost.
Signaling configuration: none needed. No Firebase, so no secrets in source. `MONGO_URL` / `DB_NAME` enable MongoDB history; without MongoDB sessions are kept in memory until the server restarts.
For devices on different networks, deploy behind HTTPS and add a TURN server to `CONFIG.iceServers` (js/config.js).

## Architecture
One `RTCPeerConnection` per pair with three RTP senders: **P1** microphone audio, **P2** camera video, **P3** optional screen-share video.
The server only relays SDP/ICE. Each browser samples its own peer connection, so values are *that peer's* view, not the whole network.

## Measured vs derived vs estimated
- **Measured:** RTT (selected candidate pair), jitter, byte/packet/frame/freeze/concealment counters, connection state.
- **Derived:** bitrates = Δbytes×8 / Δt (real elapsed time); loss % = Δlost / (Δlost+Δreceived); interruption = consecutive intervals with zero inbound bytes; recovery = interruption length when bytes resume (5 s resolution).
- **Bandwidth:** `availableOutgoingBitrate` is the browser congestion-controller *estimate* (Chromium only).
- **Estimated:** audio/video/overall quality and Good/Fair/Poor class use a configurable heuristic (js/config.js). Not subjective ratings. No ML model is running; set `QoE.predictor = { predict(features) }` to integrate one.
- Unavailable metrics are `null` / empty CSV fields. Nothing is invented. A sample is never produced if there is no peer connection.

## CSV (28 columns, in this order)
`video_id, timestamp, session_id, sample_num, rtt_ms, jitter_ms, packet_loss_pct, available_bandwidth_kbps, incoming_bitrate_kbps, outgoing_bitrate_kbps, audio_bitrate_kbps, audio_packet_loss_pct, video_bitrate_kbps, video_packet_loss_pct, frames_per_second, frames_dropped, freeze_count, freeze_duration_ms, audio_concealment_events, network_condition, connectivity_status, interruption_duration_s, recovery_time_ms, stream_type, audio_quality_score, video_quality_score, overall_quality_score, qoe_class`
Rows are validated before export (column presence, types, enums); invalid rows are rejected and reported, never "fixed". CSV is generated in the browser. Scenario markers are exported separately (`experiment_log.csv`) so the main schema stays unchanged.
`jitter_ms` is the worst inbound jitter; `stream_type` is `camera`, `camera+screen` or `audio_only`; `video_id` = `<session_id>-main`.

## Priority policy (real sender changes)
On condition change (Auto) or "Apply now" (Manual): camera encoding is changed with `RTCRtpSender.setParameters()` (maxBitrate / maxFramerate / scaleResolutionDownBy); screen share is capped, then paused with `MediaStreamTrack.enabled=false`; audio is never throttled. Every decision and its reason is logged with a timestamp.

## Experiments
The page cannot impose real packet loss or bandwidth limits. Introduce them with an external tool (DevTools throttling, OS network conditioner, `tc netem`, Clumsy) or physically, then log the scenario. The optional "sender cap" is a labelled browser-side simulation.

## Limitations
Metric support differs by browser (freeze, concealment and bandwidth estimate are mainly Chromium). Interruption/recovery have 5 s resolution. Without TURN, strict NATs may block calls (the error is shown). Scores are not validated against subjective ratings.

## Testing
Automated (done): QoE/classification/CSV validation unit tests (Node) and signaling + history API tests (FastAPI TestClient).
**Manual two-browser test (must be done on your machine, not yet executed by the author):**
1. Start the server; open two windows at `http://localhost:8000#conference`; same Room ID, different names; allow camera/mic.
2. Confirm both videos and the "waiting for participant" banner clearing; toggle mic/camera/screen share.
3. Press Start monitoring, accept consent; confirm a new row every 5 s on the dashboard.
4. Throttle one window (DevTools → Network offline/slow) and watch condition and priority log change; mark it on Experiments.
5. Stop monitoring; check the summary; Download CSV and confirm the 28-column header and one row per sample.
