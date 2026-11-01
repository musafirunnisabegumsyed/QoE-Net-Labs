from flask_socketio import SocketIO
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError

socketio = SocketIO()


class Mongo:
    """Thin holder for the PyMongo client/database, initialised in create_app()."""

    def __init__(self):
        self.client = None
        self.db = None

    def init_app(self, app, client=None):
        if client is None:
            client = MongoClient(app.config["MONGO_URI"], serverSelectionTimeoutMS=4000, tz_aware=True)
        try:
            client.admin.command("ping")
        except PyMongoError as exc:
            raise RuntimeError(
                f"Cannot reach MongoDB at {app.config['MONGO_URI']}. "
                "Start MongoDB (see README) or set MONGO_URI in .env.\n"
                f"Original error: {exc}"
            ) from exc
        self.client = client
        self.db = client[app.config["MONGO_DB"]]
        self._ensure_indexes()

    def _ensure_indexes(self):
        db = self.db
        db.sessions.create_index("session_id", unique=True)
        db.sessions.create_index([("started_at", DESCENDING)])
        db.sessions.create_index("experiment_id")
        db.measurements.create_index([("session_id", ASCENDING), ("ts", ASCENDING)])
        db.experiments.create_index("experiment_id", unique=True)
        db.signaling_events.create_index([("ts", DESCENDING)])


mongo = Mongo()
