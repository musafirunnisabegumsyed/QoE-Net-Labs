"""QoE-Net Labs entry point.  Run with:  python app.py"""
from qoe_app import create_app
from qoe_app.extensions import socketio

app = create_app()

if __name__ == "__main__":
    print(f"QoE-Net Labs running at http://{app.config['HOST']}:{app.config['PORT']}")
    socketio.run(
        app,
        host=app.config["HOST"],
        port=app.config["PORT"],
        debug=app.config["DEBUG"],
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
