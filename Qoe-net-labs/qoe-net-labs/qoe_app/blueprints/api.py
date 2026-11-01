"""REST API: sessions, measurements, experiments, dashboard data, exports."""
import json

from flask import Blueprint, Response, current_app, jsonify, request

from ..extensions import mongo, socketio
from ..services import experiments as exp_svc
from ..services import sessions as sess_svc
from ..services.export import make_response
from ..services.qoe import CLASS_THRESHOLDS, estimate_qoe
from ..utils import serialize

bp = Blueprint("api", __name__)


def err(message, code=400):
    return jsonify({"error": message}), code


def _int(name, default, lo=0, hi=500):
    try:
        return max(lo, min(hi, int(request.args.get(name, default))))
    except ValueError:
        return default


# ---------- config ----------
@bp.get("/config/ice")
def ice_config():
    cfg = current_app.config
    servers = [{"urls": cfg["STUN_URLS"]}] if cfg["STUN_URLS"] else []
    if cfg["TURN_URL"]:
        servers.append({"urls": [cfg["TURN_URL"]], "username": cfg["TURN_USERNAME"],
                        "credential": cfg["TURN_CREDENTIAL"]})
    return jsonify({"iceServers": servers, "measurement_interval_s": cfg["MEASUREMENT_INTERVAL_S"]})


@bp.get("/health")
def health():
    return jsonify({"status": "ok"})


# ---------- QoE calculation ----------
@bp.post("/qoe/classify")
def qoe_classify():
    data = request.get_json(silent=True) or {}
    return jsonify({**estimate_qoe(data), "thresholds": CLASS_THRESHOLDS})


# ---------- sessions ----------
@bp.post("/sessions")
def create_session():
    data = request.get_json(silent=True) or {}
    return jsonify(sess_svc.create_session(data, request.headers.get("User-Agent", ""))), 201


@bp.get("/sessions")
def list_sessions():
    items, total = sess_svc.list_sessions(
        room=request.args.get("room"), classification=request.args.get("classification"),
        experiment_id=request.args.get("experiment_id"), status=request.args.get("status"),
        limit=_int("limit", 20, 1, 200), skip=_int("skip", 0, 0, 10**7))
    return jsonify({"items": items, "total": total})


@bp.get("/sessions/<session_id>")
def get_session(session_id):
    s = sess_svc.get_session(session_id)
    return jsonify(s) if s else err("session not found", 404)


@bp.delete("/sessions/<session_id>")
def delete_session(session_id):
    return jsonify({"deleted": True}) if sess_svc.delete_session(session_id) else err("session not found", 404)


@bp.post("/sessions/<session_id>/end")
def end_session(session_id):
    s = sess_svc.end_session(session_id)
    return jsonify(s) if s else err("session not found", 404)


@bp.post("/sessions/<session_id>/rating")
def rate_session(session_id):
    data = request.get_json(silent=True) or {}
    try:
        ok = sess_svc.set_rating(session_id, data.get("score"), data.get("comment", ""))
    except ValueError as e:
        return err(str(e))
    return jsonify(sess_svc.get_session(session_id)) if ok else err("session not found", 404)


@bp.post("/sessions/<session_id>/measurements")
def add_measurement(session_id):
    data = request.get_json(silent=True) or {}
    result = sess_svc.add_measurement(session_id, data, current_app.config["MEASUREMENT_INTERVAL_S"])
    if result is None:
        return err("session not found", 404)
    doc, qoe = result
    socketio.emit("qoe:update", doc, to="dashboard")
    return jsonify({"measurement": doc, "qoe": qoe}), 201


@bp.get("/sessions/<session_id>/measurements")
def list_measurements(session_id):
    if not sess_svc.get_session(session_id):
        return err("session not found", 404)
    return jsonify({"items": sess_svc.list_measurements(session_id)})


# ---------- experiments ----------
@bp.get("/experiments")
def list_experiments():
    return jsonify({"items": exp_svc.list_experiments(), "scenarios": exp_svc.SCENARIOS})


@bp.post("/experiments")
def create_experiment():
    try:
        return jsonify(exp_svc.create_experiment(request.get_json(silent=True) or {})), 201
    except ValueError as e:
        return err(str(e))


@bp.get("/experiments/<experiment_id>")
def get_experiment(experiment_id):
    e = exp_svc.get_experiment(experiment_id)
    return jsonify(e) if e else err("experiment not found", 404)


@bp.delete("/experiments/<experiment_id>")
def delete_experiment(experiment_id):
    return jsonify({"deleted": True}) if exp_svc.delete_experiment(experiment_id) else err("experiment not found", 404)


# ---------- dashboard ----------
@bp.get("/dashboard/summary")
def dashboard_summary():
    return jsonify(sess_svc.dashboard_summary())


# ---------- exports ----------
def _fmt(fmt):
    return fmt if fmt in ("csv", "json") else None


@bp.get("/export/sessions.<fmt>")
def export_sessions(fmt):
    if not _fmt(fmt):
        return err("format must be csv or json", 404)
    items, _ = sess_svc.list_sessions(experiment_id=request.args.get("experiment_id"), limit=200000)
    return make_response(items, fmt, "qoe_sessions")


@bp.get("/export/measurements.<fmt>")
def export_measurements(fmt):
    if not _fmt(fmt):
        return err("format must be csv or json", 404)
    query = {}
    if request.args.get("session_id"):
        query["session_id"] = request.args["session_id"]
    rows = [serialize(d) for d in mongo.db.measurements.find(query).sort([("session_id", 1), ("ts", 1)])]
    return make_response(rows, fmt, "qoe_measurements")


@bp.get("/export/session/<session_id>.<fmt>")
def export_one_session(session_id, fmt):
    if not _fmt(fmt):
        return err("format must be csv or json", 404)
    s = sess_svc.get_session(session_id)
    if not s:
        return err("session not found", 404)
    rows = sess_svc.list_measurements(session_id)
    if fmt == "json":
        return Response(json.dumps({"session": s, "measurements": rows}, indent=2),
                        mimetype="application/json",
                        headers={"Content-Disposition": f'attachment; filename="session_{session_id}.json"'})
    return make_response(rows, "csv", f"session_{session_id}")


@bp.get("/export/experiments.<fmt>")
def export_experiments(fmt):
    if not _fmt(fmt):
        return err("format must be csv or json", 404)
    return make_response(exp_svc.list_experiments(), fmt, "qoe_experiments")
