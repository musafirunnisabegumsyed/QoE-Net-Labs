"""Objective QoE estimation and classification.

The score is a transparent *heuristic* (not ITU-T P.1203 and not a subjective
rating).  It maps one five-second WebRTC getStats() window to an estimated MOS
in [1, 5]:

    video quality  = weighted mix of bitrate adequacy, frame rate and resolution
    MOS            = 1 + 4 * video quality
                     - packet-loss penalty - delay penalty
                     - jitter penalty      - freeze penalty
    outage window  (no media received)      -> MOS 1.0
"""
import math

from ..utils import to_float

MODEL_NAME = "heuristic-v1"
CLASS_THRESHOLDS = [(4.3, "Excellent"), (3.6, "Good"), (2.6, "Fair"), (1.8, "Poor"), (0.0, "Bad")]
BITS_PER_PIXEL = 0.07  # expected bits per pixel per frame at 30 fps


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def classify(mos):
    mos = to_float(mos, 1.0)
    for threshold, label in CLASS_THRESHOLDS:
        if mos >= threshold:
            return label
    return "Bad"


def estimate_qoe(m, interval_s=5):
    width = to_float(m.get("frame_width"), 0) or 0
    height = to_float(m.get("frame_height"), 0) or 0
    fps = to_float(m.get("fps"), 0) or 0
    bitrate = to_float(m.get("bitrate_kbps"), 0) or 0
    loss = _clamp(to_float(m.get("packet_loss_pct"), 0) or 0, 0, 100)
    jitter = max(0.0, to_float(m.get("jitter_ms"), 0) or 0)
    rtt = max(0.0, to_float(m.get("rtt_ms"), 0) or 0)
    freeze_count = max(0.0, to_float(m.get("freeze_count"), 0) or 0)
    freeze_dur = max(0.0, to_float(m.get("freeze_duration_s"), 0) or 0)

    outage = bitrate <= 1 or fps <= 0.5
    if outage:
        return {
            "mos": 1.0,
            "classification": "Bad",
            "outage": True,
            "components": {"video_quality": 0.0, "loss_penalty": 0.0, "delay_penalty": 0.0,
                           "jitter_penalty": 0.0, "freeze_penalty": 0.0},
            "model": MODEL_NAME,
        }

    pixels = max(width * height, 1)
    expected_kbps = max(pixels * 30 * BITS_PER_PIXEL / 1000.0, 50.0)
    bitrate_score = _clamp(bitrate / expected_kbps) ** 0.5
    fps_score = _clamp(fps / 30.0) ** 0.7
    res_score = _clamp(math.log(pixels / 19200.0) / math.log(48.0)) if pixels > 19200 else 0.0
    video_quality = 0.4 * bitrate_score + 0.3 * fps_score + 0.3 * res_score

    loss_pen = 2.2 * (1 - math.exp(-loss / 6.0))
    one_way_delay = rtt / 2.0 + jitter
    delay_pen = 1.2 * _clamp((one_way_delay - 150.0) / 450.0)
    jitter_pen = 0.8 * _clamp((jitter - 30.0) / 120.0)
    freeze_ratio = _clamp(freeze_dur / float(interval_s))
    freeze_pen = 2.0 * freeze_ratio + min(0.6, 0.2 * freeze_count)

    mos = 1 + 4 * video_quality - loss_pen - delay_pen - jitter_pen - freeze_pen
    mos = round(_clamp(mos, 1.0, 5.0), 2)
    return {
        "mos": mos,
        "classification": classify(mos),
        "outage": False,
        "components": {
            "video_quality": round(video_quality, 3),
            "loss_penalty": round(loss_pen, 3),
            "delay_penalty": round(delay_pen, 3),
            "jitter_penalty": round(jitter_pen, 3),
            "freeze_penalty": round(freeze_pen, 3),
        },
        "model": MODEL_NAME,
    }


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 3)
