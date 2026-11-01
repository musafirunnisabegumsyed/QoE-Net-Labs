"""Flask-SocketIO WebRTC signaling.  Only control messages pass through the
server (room join, SDP offer/answer, ICE candidates); media flows peer-to-peer."""
import threading

from flask import request
from flask_socketio import emit, join_room, leave_room

from ..extensions import mongo
from ..services import sessions as sess_svc
from ..utils import utcnow

MAX_PEERS = 2
_lock = threading.Lock()
rooms = {}        # room -> {sid: {"participant":..., "session_id":...}}
sid_room = {}     # sid -> room


def _log(event, room=None, sid=None, session_id=None, **extra):
    try:
        mongo.db.signaling_events.insert_one(
            {"ts": utcnow(), "event": event, "room": room, "sid": sid, "session_id": session_id, **extra})
    except Exception:  # logging must never break signaling
        pass


def _leave(sid):
    with _lock:
        room = sid_room.pop(sid, None)
        info = rooms.get(room, {}).pop(sid, None) if room else None
        if room and not rooms.get(room):
            rooms.pop(room, None)
    if room:
        leave_room(room, sid=sid)
        emit("peer-left", {"sid": sid}, to=room, skip_sid=sid)
        _log("leave", room, sid, (info or {}).get("session_id"))
    return info


def register_signaling(socketio):
    @socketio.on("dashboard:subscribe")
    def dashboard_subscribe():
        join_room("dashboard")

    @socketio.on("join")
    def on_join(data):
        data = data or {}
        room = str(data.get("room", "")).strip()[:64]
        if not room:
            emit("error", {"message": "room is required"})
            return
        sid = request.sid
        with _lock:
            peers = rooms.setdefault(room, {})
            if sid not in peers and len(peers) >= MAX_PEERS:
                emit("room-full", {"room": room})
                return
            existing = list(peers.keys())
            peers[sid] = {"participant": str(data.get("participant", ""))[:48],
                          "session_id": data.get("session_id")}
            sid_room[sid] = room
        join_room(room)
        emit("joined", {"sid": sid, "room": room, "peers": existing})
        emit("peer-joined", {"sid": sid, "participant": peers[sid]["participant"]}, to=room, skip_sid=sid)
        _log("join", room, sid, data.get("session_id"))

    def _relay(event, key):
        def handler(data):
            sid = request.sid
            room = sid_room.get(sid)
            if not room or not data or key not in data:
                return
            emit(event, {key: data[key], "from": sid}, to=room, skip_sid=sid)
            if event != "ice-candidate":
                _log(event, room, sid, (rooms.get(room, {}).get(sid) or {}).get("session_id"))
        return handler

    socketio.on_event("offer", _relay("offer", "sdp"))
    socketio.on_event("answer", _relay("answer", "sdp"))
    socketio.on_event("ice-candidate", _relay("ice-candidate", "candidate"))

    @socketio.on("leave")
    def on_leave():
        _leave(request.sid)

    @socketio.on("disconnect")
    def on_disconnect(*_):
        info = _leave(request.sid)
        if info and info.get("session_id"):
            sess_svc.end_session(info["session_id"])
