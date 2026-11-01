from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc)


def _ser(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {k: _ser(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [_ser(v) for v in value]
    return value


def serialize(doc):
    """Make a Mongo document JSON-safe (drops _id, ISO-formats datetimes)."""
    return None if doc is None else _ser(doc)


def to_float(value, default=None):
    try:
        f = float(value)
        if f != f or f in (float("inf"), float("-inf")):
            return default
        return f
    except (TypeError, ValueError):
        return default
