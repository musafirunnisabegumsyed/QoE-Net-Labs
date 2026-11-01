# QoE-Net Labs (Flask edition)

WebRTC video-conferencing QoE monitoring and prediction. Research prototype for
*Subjective and Objective Quality of Experience (QoE) Framework for Video Conferencing
Services with Intermittent Network Connectivity*.

**Stack:** Python Flask · Flask-SocketIO (signaling) · PyMongo / MongoDB · vanilla browser JavaScript.
No FastAPI, Node.js or Express.

| Layer | Responsibility |
|---|---|
| Browser JS | Camera and mic, `RTCPeerConnection`, 5 s `getStats()` loop, resource allocation (resolution, fps, bitrate cap), outage injection, charts |
| Flask Blueprints | Pages (`pages`), REST + exports (`api`), Socket.IO signaling (`signaling`) |
| Services | QoE calculation and classification, session management, experiment records, CSV/JSON export |
| MongoDB | `sessions`, `measurements`, `experiments`, `signaling_events` |

Video and audio travel peer to peer. Flask only relays room join, SDP offer/answer and ICE candidates.

## Setup

1. **Python 3.9+** and **MongoDB 6+** are required.
2. Start MongoDB locally, using any one of these:
   - Linux/macOS service: `sudo systemctl start mongod` / `brew services start mongodb-community`
   - Docker: `docker run -d --name qoe-mongo -p 27017:27017 mongo:7`
   - Or use a MongoDB Atlas connection string in `MONGO_URI`.
3. Install and run:
   ```bash
   python -m venv .venv
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env             # optional, edit MONGO_URI etc.
   python app.py
   ```
4. Open http://127.0.0.1:5000

### MongoDB configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017` | Connection string |
| `MONGO_DB` | `qoenet_labs` | Database name (collections and indexes are created automatically) |
| `STUN_URLS` | Google public STUN | Comma-separated STUN servers |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | empty | Optional TURN relay for restrictive NATs |
| `MEASUREMENT_INTERVAL_S` | `5` | `getStats()` sampling period |
| `HOST`, `PORT` | `127.0.0.1`, `5000` | Server bind address |

If MongoDB is unreachable the app stops at startup with a message saying so.

## Testing a call

- Browsers only allow camera access on `localhost` or HTTPS. For two devices on a LAN, serve over HTTPS (reverse proxy) or use a tunnel.
- Same machine: open the page in **two different browsers** (or two profiles). Two tabs of one browser often work, but some systems lock the camera.
- Both sides: Conference → *Start camera and microphone* → same room name → *Join room*.
- After about 5 s of a connected call, measurements appear and are saved. Open **QoE Dashboard** in a third tab to see live updates.
- *Leave and rate* ends the session and stores the participant's 1–5 rating.

## Experiments

Create an experiment (resolution, fps, bitrate cap, optional outage length and interval) and press **Run**. The Conference page loads those settings and links every session to the experiment. The Experiments table aggregates mean estimated MOS and mean participant rating.

**Network impairment:** the "Inject outage" control pauses the sender's encodings (real effect, seen in the *other* peer's stats). For packet loss, delay or bandwidth caps use OS-level tools (Chrome DevTools throttling, `tc netem`, macOS Network Link Conditioner, Clumsy on Windows).

## Estimated QoE

`qoe_app/services/qoe.py` — heuristic MOS (1–5) per window from bitrate adequacy, fps, resolution minus penalties for loss, delay, jitter and freezes; no media received ⇒ 1.0. Classes: Excellent ≥4.3, Good ≥3.6, Fair ≥2.6, Poor ≥1.8, otherwise Bad. It is **not** a subjective rating; the dashboard shows the Pearson correlation against participants' ratings once ≥3 sessions are rated.

## REST API

| Method & path | Purpose |
|---|---|
| `GET /api/config/ice` | ICE servers and sampling interval |
| `POST /api/qoe/classify` | Stateless QoE calculation from a metrics JSON |
| `POST /api/sessions` · `GET /api/sessions?room=&classification=&experiment_id=&limit=&skip=` | Create / list sessions |
| `GET/DELETE /api/sessions/<id>` · `POST /api/sessions/<id>/end` · `POST /api/sessions/<id>/rating` | Session lifecycle and subjective rating |
| `POST/GET /api/sessions/<id>/measurements` | Store (QoE computed server-side) / read measurements |
| `GET/POST /api/experiments` · `GET/DELETE /api/experiments/<id>` | Experiment records |
| `GET /api/dashboard/summary` | Totals, class distribution, averages, correlation, recent sessions |
| `GET /api/export/sessions.(csv\|json)` | All sessions (`?experiment_id=` to filter) |
| `GET /api/export/measurements.(csv\|json)` | All measurements (`?session_id=` to filter) |
| `GET /api/export/session/<id>.(csv\|json)` | One session with measurements |
| `GET /api/export/experiments.(csv\|json)` | Experiments with aggregates |

Socket.IO events: `join`, `joined`, `peer-joined`, `offer`, `answer`, `ice-candidate`, `leave`, `peer-left`, `room-full`, `dashboard:subscribe`, `qoe:update`.

## Layout

```
app.py                      entry point (python app.py)
config.py                   env-based configuration
qoe_app/
  __init__.py               application factory
  extensions.py             SocketIO + PyMongo holder, indexes
  blueprints/{pages,api,signaling}.py
  services/{qoe,sessions,experiments,export}.py
templates/                  Jinja pages (home, conference, dashboard, experiments, history, about)
static/{css,js,vendor}      styles, browser JS (WebRTC + stats), bundled socket.io client
```
