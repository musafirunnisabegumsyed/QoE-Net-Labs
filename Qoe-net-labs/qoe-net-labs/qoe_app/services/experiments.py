"""Experiment records: a named test condition that sessions can be attached to."""
import uuid

from ..extensions import mongo
from ..utils import serialize, to_float, utcnow

SCENARIOS = ["baseline", "bandwidth_limit", "resolution_scaling", "intermittent_outage", "custom"]


def create_experiment(data):
    name = str(data.get("name", "")).strip()
    if not name:
        raise ValueError("name is required")
    scenario = data.get("scenario", "custom")
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {SCENARIOS}")
    p = data.get("params") or {}
    doc = {
        "experiment_id": "exp_" + uuid.uuid4().hex[:8],
        "name": name[:80],
        "scenario": scenario,
        "description": str(data.get("description", ""))[:500],
        "params": {
            "resolution": str(p.get("resolution", "640x480"))[:16],
            "fps": to_float(p.get("fps"), 30),
            "max_bitrate_kbps": to_float(p.get("max_bitrate_kbps"), 1000),
            "outage_duration_s": to_float(p.get("outage_duration_s"), 0),
            "outage_interval_s": to_float(p.get("outage_interval_s"), 0),
        },
        "created_at": utcnow(),
    }
    mongo.db.experiments.insert_one(doc)
    return serialize(doc)


def _stats_for(experiment_id):
    sessions = list(mongo.db.sessions.find({"experiment_id": experiment_id}))
    moses = [s["summary"]["mean_mos"] for s in sessions
             if (s.get("summary") or {}).get("mean_mos") is not None]
    ratings = [s["rating"]["score"] for s in sessions if s.get("rating")]
    return {
        "sessions": len(sessions),
        "mean_mos": round(sum(moses) / len(moses), 2) if moses else None,
        "mean_subjective": round(sum(ratings) / len(ratings), 2) if ratings else None,
    }


def list_experiments(with_stats=True):
    out = []
    for d in mongo.db.experiments.find().sort("created_at", -1):
        item = serialize(d)
        if with_stats:
            item["stats"] = _stats_for(d["experiment_id"])
        out.append(item)
    return out


def get_experiment(experiment_id):
    d = mongo.db.experiments.find_one({"experiment_id": experiment_id})
    if not d:
        return None
    item = serialize(d)
    item["stats"] = _stats_for(experiment_id)
    return item


def delete_experiment(experiment_id):
    mongo.db.sessions.update_many({"experiment_id": experiment_id}, {"$set": {"experiment_id": None}})
    return mongo.db.experiments.delete_one({"experiment_id": experiment_id}).deleted_count > 0
