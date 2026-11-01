import os, time, uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()
rooms: dict[str, dict[str, WebSocket]] = {}
queues: dict[str, list] = {}          # HTTP polling fallback: room -> [{id,from,msg}]
mem_sessions: dict[str, dict] = {}    # used when MongoDB is unavailable

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"),
                            serverSelectionTimeoutMS=1500)[os.getenv("DB_NAME", "qoe_net")]
except Exception:
    db = None

@app.websocket("/api/ws/{room}")
async def ws(sock: WebSocket, room: str):
    await sock.accept()
    cid = uuid.uuid4().hex[:8]
    peers = rooms.setdefault(room, {})
    if len(peers) >= 2:
        await sock.send_json({"type": "full"}); await sock.close(); return
    for p in peers.values():
        await p.send_json({"type": "peer-joined", "from": cid})
    peers[cid] = sock
    await sock.send_json({"type": "welcome", "id": cid, "peers": len(peers)})
    try:
        while True:
            msg = await sock.receive_json()           # SDP / ICE only
            for pid, p in list(peers.items()):
                if pid != cid:
                    await p.send_json({**msg, "from": cid})
    except WebSocketDisconnect:
        pass
    finally:
        peers.pop(cid, None)
        for p in peers.values():
            await p.send_json({"type": "peer-left", "from": cid})
        if not peers: rooms.pop(room, None)

@app.post("/api/signal/{room}")
async def post_signal(room: str, body: dict):
    q = queues.setdefault(room, [])
    q.append({"n": (q[-1]["n"] + 1) if q else 1, "from": body.get("from"), "msg": body.get("msg")})
    del q[:-200]
    return {"ok": True}

@app.get("/api/signal/{room}")
async def get_signal(room: str, client: str, since: int = 0):
    q = [m for m in queues.get(room, []) if m["n"] > since and m["from"] != client]
    return {"messages": q, "last": max([m["n"] for m in queues.get(room, [])] or [0])}

@app.post("/api/sessions")
async def save_session(s: dict):
    s["_id"] = s.get("id") or uuid.uuid4().hex
    s["saved_at"] = time.time()
    try:
        if db is None: raise RuntimeError
        await db.sessions.replace_one({"_id": s["_id"]}, s, upsert=True)
    except Exception:
        mem_sessions[s["_id"]] = s
    return {"id": s["_id"]}

@app.get("/api/sessions")
async def list_sessions():
    try:
        if db is None: raise RuntimeError
        docs = await db.sessions.find({}, {"samples": 0}).sort("saved_at", -1).to_list(100)
    except Exception:
        docs = [{k: v for k, v in s.items() if k != "samples"} for s in mem_sessions.values()]
    return docs

@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    try:
        if db is None: raise RuntimeError
        d = await db.sessions.find_one({"_id": sid})
    except Exception:
        d = mem_sessions.get(sid)
    if not d: raise HTTPException(404)
    return d

@app.delete("/api/sessions/{sid}")
async def del_session(sid: str):
    mem_sessions.pop(sid, None)
    try:
        if db is not None: await db.sessions.delete_one({"_id": sid})
    except Exception:
        pass
    return {"ok": True}

@app.get("/")
async def index(): return FileResponse("static/index.html")
app.mount("/", StaticFiles(directory="static"), name="static")
