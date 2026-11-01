from flask import Flask

from config import Config
from .extensions import mongo, socketio


def create_app(config_object=Config, mongo_client=None):
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(config_object)

    mongo.init_app(app, client=mongo_client)
    socketio.init_app(app, cors_allowed_origins="*", async_mode="threading")

    from .blueprints.api import bp as api_bp
    from .blueprints.pages import bp as pages_bp
    from .blueprints.signaling import register_signaling

    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
    register_signaling(socketio)
    return app
