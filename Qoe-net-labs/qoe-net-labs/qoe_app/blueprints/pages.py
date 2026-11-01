from flask import Blueprint, render_template

bp = Blueprint("pages", __name__)


@bp.get("/")
def home():
    return render_template("home.html")


@bp.get("/conference")
def conference():
    return render_template("conference.html")


@bp.get("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@bp.get("/experiments")
def experiments():
    return render_template("experiments.html")


@bp.get("/history")
def history():
    return render_template("history.html")


@bp.get("/about")
def about():
    return render_template("about.html")
