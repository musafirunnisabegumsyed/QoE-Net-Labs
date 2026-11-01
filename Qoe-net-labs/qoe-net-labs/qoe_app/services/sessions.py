"""Conference session management and QoE measurement storage."""
import uuid

from ..extensions import mongo
from ..utils import serialize, to_float, utcnow
from .qoe import classify, estimate_qoe, pearson

NUMERIC_FIELDS = [
    "bitrate_kbps", "send_bitrate_kbps", "fps", "frame_width", "frame_height",
    "packet_loss_pct", "jitter_ms", "rtt_ms", "jitter_buffer_delay_ms",
    "freeze_count", "freeze_duration_s", "available_outgoing_kbps",
    "target_width", "target_height", "target_fps", "target_bitrate_kbps",
    "window_s",
]
STRING_FIELDS = ["quality_limitation", "connection_state", "ice_state"]
BOOL_FIELDS = ["outage_injected_local"]
CLASSES = ["Excellent", "Good", "Fair", "Poor", "Bad"]


def create_session(data, user_agent=""):
    session_id = uuid.uuid4().hex[:12]
    cfg = data.get("config") or {}
    doc = {
        "session_id": session_id,
        "room": str(data.get("room", "")).strip()[:64] or "default",
        "participant": str(data.get("participant", "")).strip()[:48] or "anonymous",
        "experiment_id": data.get("experiment_id") or None,
        "config": {
            "resolution": str(cfg.get("resolution", ""))[:16],
            "fps": to_float(cfg.get("fps")),
            "max_bitrate_kbps": to_float(cfg.get("max_bitrate_kbps")),
        },
        "user_agent": user_agent[:300],
        "status": "active",
        "started_at": utcnow(),
        "ended_at": None,
        "last_measurement_at": None,
        "summary": None,
        "rating": None,
    }
    mongo.db.sessions.insert_one(doc)
    return serialize(doc)


def get_session(session_id):
    return serialize(mongo.db.sessions.find_one({"session_id": session_id}))


def add_measurement(session_id, data, interval_s=5):
    session = mongo.db.sessions.find_one({"session_id": session_id})
    if not session:
        return None
    doc = {"session_id": session_id, "participant": session.get("participant"), "ts": utcnow()}
    for key in NUMERIC_FIELDS:
        doc[key] = to_float(data.get(key))
    for key in STRING_FIELDS:
        value = data.get(key)
        doc[key] = str(value)[:40] if value is not None else None
    for key in BOOL_FIELDS:
        doc[key] = bool(data.get(key, False))
    doc["seq"] = mongo.db.measurements.count_documents({"session_id": session_id}) + 1
    qoe = estimate_qoe(doc, interval_s=doc.get("window_s") or interval_s)
    doc["qoe_mos"] = qoe["mos"]
    doc["qoe_class"] = qoe["classification"]
    doc["qoe_outage"] = qoe["outage"]
    doc["qoe_components"] = qoe["components"]
    doc["qoe_model"] = qoe["model"]
    mongo.db.measurements.insert_one(doc)
    mongo.db.sessions.update_one({"session_id": session_id}, {"$set": {"last_measurement_at": doc["ts"]}})
    return serialize(doc), qoe


def list_measurements(session_id):
    cur = mongo.db.measurements.find({"session_id": session_id}).sort("ts", 1)
    return [serialize(d) for d in cur]


def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 3) if values else None


def compute_summary(session_id):
    rows = list(mongo.db.measurements.find({"session_id": session_id}))
    if not rows:
        return {"samples": 0}
    mos = [r["qoe_mos"] for r in rows]
    dist = {c: 0 for c in CLASSES}
    for r in rows:
        dist[r["qoe_class"]] = dist.get(r["qoe_class"], 0) + 1
    mean = round(sum(mos) / len(mos), 2)
    return {
        "samples": len(rows),
        "mean_mos": mean,
        "min_mos": min(mos),
        "max_mos": max(mos),
        "classification": classify(mean),
        "class_distribution": dist,
        "outage_samples": sum(1 for r in rows if r.get("qoe_outage")),
        "avg_bitrate_kbps": _avg([r.get("bitrate_kbps") for r in rows]),
        "avg_fps": _avg([r.get("fps") for r in rows]),
        "avg_packet_loss_pct": _avg([r.get("packet_loss_pct") for r in rows]),
        "avg_jitter_ms": _avg([r.get("jitter_ms") for r in rows]),
        "avg_rtt_ms": _avg([r.get("rtt_ms") for r in rows]),
        "total_freeze_count": sum(r.get("freeze_count") or 0 for r in rows),
        "total_freeze_duration_s": round(sum(r.get("freeze_duration_s") or 0 for r in rows), 2),
    }


def end_session(session_id):
    session = mongo.db.sessions.find_one({"session_id": session_id})
    if not session:
        return None
    if session.get("status") == "ended":
        return serialize(session)
    mongo.db.sessions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "ended", "ended_at": utcnow(), "summary": compute_summary(session_id)}},
    )
    return get_session(session_id)


def set_rating(session_id, score, comment=""):
    score = to_float(score)
    if score is None or not 1 <= score <= 5:
        raise ValueError("score must be a number between 1 and 5")
    res = mongo.db.sessions.update_one(
        {"session_id": session_id},
        {"$set": {"rating": {"score": round(score, 1), "comment": str(comment)[:500], "rated_at": utcnow()}}},
    )
    return res.matched_count > 0


def delete_session(session_id):
    mongo.db.measurements.delete_many({"session_id": session_id})
    return mongo.db.sessions.delete_one({"session_id": session_id}).deleted_count > 0


def list_sessions(room=None, classification=None, experiment_id=None, status=None, limit=20, skip=0):
    query = {}
    if room:
        query["room"] = {"$regex": room, "$options": "i"}
    if classification:
        query["summary.classification"] = classification
    if experiment_id:
        query["experiment_id"] = experiment_id
    if status:
        query["status"] = status
    total = mongo.db.sessions.count_documents(query)
    cur = mongo.db.sessions.find(query).sort("started_at", -1).skip(skip).limit(limit)
    return [serialize(d) for d in cur], total


def dashboard_summary():
    db = mongo.db
    total_sessions = db.sessions.count_documents({})
    active = db.sessions.count_documents({"status": "active"})
    total_measurements = db.measurements.count_documents({})

    agg = list(db.measurements.aggregate([{"$group": {
        "_id": None,
        "mos": {"$avg": "$qoe_mos"}, "bitrate": {"$avg": "$bitrate_kbps"}, "fps": {"$avg": "$fps"},
        "loss": {"$avg": "$packet_loss_pct"}, "jitter": {"$avg": "$jitter_ms"}, "rtt": {"$avg": "$rtt_ms"},
    }}]))
    a = agg[0] if agg else {}
    dist = {c: 0 for c in CLASSES}
    for row in db.measurements.aggregate([{"$group": {"_id": "$qoe_class", "n": {"$sum": 1}}}]):
        dist[row["_id"]] = row["n"]

    pairs = []
    for s in db.sessions.find({"rating": {"$ne": None}}):
        mean = (s.get("summary") or {}).get("mean_mos")
        if mean is not None:
            pairs.append((mean, s["rating"]["score"]))
    ratings = [p[1] for p in pairs]

    def r(v, n=2):
        return round(v, n) if v is not None else None

    recent, _ = list_sessions(limit=8)
    return {
        "total_sessions": total_sessions,
        "active_sessions": active,
        "total_measurements": total_measurements,
        "mean_mos": r(a.get("mos")),
        "mean_classification": classify(a["mos"]) if a.get("mos") is not None else None,
        "averages": {k: r(a.get(k)) for k in ("bitrate", "fps", "loss", "jitter", "rtt")},
        "class_distribution": dist,
        "rated_sessions": len(pairs),
        "mean_subjective": r(sum(ratings) / len(ratings)) if ratings else None,
        "objective_vs_subjective_pearson": pearson([p[0] for p in pairs], ratings),
        "recent_sessions": recent,
        "recent_signaling": [serialize(d) for d in db.signaling_events.find().sort("ts", -1).limit(10)],
    }
