import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB = os.getenv("MONGO_DB", "qoenet_labs")
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("PORT", "5000"))
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    STUN_URLS = [u.strip() for u in os.getenv("STUN_URLS", "stun:stun.l.google.com:19302").split(",") if u.strip()]
    TURN_URL = os.getenv("TURN_URL", "")
    TURN_USERNAME = os.getenv("TURN_USERNAME", "")
    TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL", "")
    MEASUREMENT_INTERVAL_S = int(os.getenv("MEASUREMENT_INTERVAL_S", "5"))
