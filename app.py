import os
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc


def _database_url() -> str:
    configured_url = os.getenv("DATABASE_URL", "sqlite:///plant_app.db")
    if configured_url.startswith("postgres://"):
        # SQLAlchemy expects the postgres+psycopg2 driver prefix.
        configured_url = configured_url.replace("postgres://", "postgresql+psycopg2://", 1)
    return configured_url


app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = _database_url()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)


class Plant(db.Model):
    __tablename__ = "plants"

    id = db.Column(db.Integer, primary_key=True)
    plant_id = db.Column(db.String(128), unique=True, nullable=False, index=True)
    plant_name = db.Column(db.String(128), nullable=False, default="Plant")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class PlantSetting(db.Model):
    __tablename__ = "plant_settings"

    id = db.Column(db.Integer, primary_key=True)
    plant_ref = db.Column(db.Integer, db.ForeignKey("plants.id"), nullable=False, unique=True, index=True)
    start_threshold = db.Column(db.Float, nullable=False, default=20.0)
    stop_threshold = db.Column(db.Float, nullable=False, default=35.0)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MoistureReading(db.Model):
    __tablename__ = "moisture_readings"

    id = db.Column(db.Integer, primary_key=True)
    plant_ref = db.Column(db.Integer, db.ForeignKey("plants.id"), nullable=False, index=True)
    moisture = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


def _ensure_tables() -> None:
    with app.app_context():
        db.create_all()


def _validate_thresholds(start_threshold: float, stop_threshold: float) -> str | None:
    if start_threshold < 0 or start_threshold > 100:
        return "start_threshold must be between 0 and 100"
    if stop_threshold < 0 or stop_threshold > 100:
        return "stop_threshold must be between 0 and 100"
    if start_threshold >= stop_threshold:
        return "start_threshold must be less than stop_threshold"
    return None


def _parse_timestamp(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _require_device_auth() -> bool:
    expected_token = os.getenv("DEVICE_API_TOKEN", "").strip()
    if not expected_token:
        return True

    bearer = request.headers.get("Authorization", "")
    if bearer.startswith("Bearer "):
        supplied_token = bearer.removeprefix("Bearer ").strip()
        return supplied_token == expected_token

    # Optional compatibility fallback for early testing.
    supplied_query_token = request.args.get("private_key", "").strip()
    return supplied_query_token == expected_token


def _get_or_create_plant(plant_id: str, plant_name: str | None) -> Plant:
    plant = Plant.query.filter_by(plant_id=plant_id).first()
    if plant:
        if plant_name and plant_name.strip() and plant.plant_name != plant_name.strip():
            plant.plant_name = plant_name.strip()
        return plant

    generated_name = (plant_name or plant_id).strip() or plant_id
    plant = Plant(plant_id=plant_id, plant_name=generated_name)
    db.session.add(plant)
    db.session.flush()
    db.session.add(PlantSetting(plant_ref=plant.id))
    return plant


def _plant_settings(plant_ref: int) -> PlantSetting:
    settings = PlantSetting.query.filter_by(plant_ref=plant_ref).first()
    if settings is None:
        settings = PlantSetting(plant_ref=plant_ref)
        db.session.add(settings)
        db.session.flush()
    return settings


@app.route("/")
def home():
    return redirect(url_for("dashboard"))


@app.route("/health")
def health():
    return jsonify({"ok": True, "time": datetime.now(timezone.utc).isoformat()})


@app.route("/api/device/telemetry", methods=["POST"])
def device_telemetry():
    if not _require_device_auth():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    plant_id = str(payload.get("plant_id", "")).strip()
    if not plant_id:
        return jsonify({"ok": False, "error": "plant_id is required"}), 400

    try:
        moisture = float(payload.get("moisture"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "moisture must be a number"}), 400

    if moisture < 0 or moisture > 100:
        return jsonify({"ok": False, "error": "moisture must be between 0 and 100"}), 400

    plant = _get_or_create_plant(plant_id, payload.get("plant_name"))
    settings = _plant_settings(plant.id)

    start_threshold = payload.get("start_threshold")
    stop_threshold = payload.get("stop_threshold")
    if start_threshold is not None and stop_threshold is not None:
        try:
            start_value = float(start_threshold)
            stop_value = float(stop_threshold)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "thresholds must be numbers"}), 400

        threshold_error = _validate_thresholds(start_value, stop_value)
        if threshold_error:
            return jsonify({"ok": False, "error": threshold_error}), 400

        settings.start_threshold = start_value
        settings.stop_threshold = stop_value

    reading = MoistureReading(
        plant_ref=plant.id,
        moisture=moisture,
        created_at=_parse_timestamp(payload.get("timestamp")),
    )
    db.session.add(reading)
    db.session.commit()

    return jsonify({"ok": True, "plant_id": plant_id, "moisture": moisture})


@app.route("/api/device/settings", methods=["GET"])
def device_settings():
    if not _require_device_auth():
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    plant_id = request.args.get("plant_id", "").strip()
    if not plant_id:
        return jsonify({"ok": False, "error": "plant_id is required"}), 400

    plant = _get_or_create_plant(plant_id, None)
    settings = _plant_settings(plant.id)
    db.session.commit()

    # Bubble-compatible shape so existing firmware keeps working.
    # Also include top-level fields for simpler clients/tools.
    return jsonify(
        {
            "ok": True,
            "plant_id": plant.plant_id,
            "plant_name": plant.plant_name,
            "start_threshold": settings.start_threshold,
            "stop_threshold": settings.stop_threshold,
            "response": {
                "results": [
                    {
                        "plant_name": plant.plant_name,
                        "start_threshold": settings.start_threshold,
                        "stop_threshold": settings.stop_threshold,
                    }
                ]
            }
        }
    )


@app.route("/api/app/chart", methods=["GET"])
def chart_data():
    plant_id = request.args.get("plant_id", "").strip()
    if not plant_id:
        return jsonify({"ok": False, "error": "plant_id is required"}), 400

    plant = Plant.query.filter_by(plant_id=plant_id).first()
    if not plant:
        return jsonify({"ok": True, "plant_id": plant_id, "points": []})

    range_key = request.args.get("range", "24h").strip()
    hours_lookup = {"24h": 24, "7d": 24 * 7, "30d": 24 * 30}
    max_age = timedelta(hours=hours_lookup.get(range_key, 24))
    cutoff = datetime.now(timezone.utc) - max_age

    readings = (
        MoistureReading.query.filter(MoistureReading.plant_ref == plant.id, MoistureReading.created_at >= cutoff)
        .order_by(MoistureReading.created_at.asc())
        .all()
    )

    points = [
        {
            "time": reading.created_at.astimezone(timezone.utc).isoformat(),
            "moisture": round(reading.moisture, 2),
        }
        for reading in readings
    ]
    return jsonify({"ok": True, "plant_id": plant_id, "points": points})


@app.route("/dashboard")
def dashboard():
    plants = Plant.query.order_by(Plant.plant_name.asc()).all()
    selected_plant_id = request.args.get("plant_id", "").strip()
    if not selected_plant_id and plants:
        selected_plant_id = plants[0].plant_id

    selected_plant = Plant.query.filter_by(plant_id=selected_plant_id).first() if selected_plant_id else None
    latest_reading = None
    selected_settings = None
    if selected_plant:
        latest_reading = (
            MoistureReading.query.filter_by(plant_ref=selected_plant.id)
            .order_by(desc(MoistureReading.created_at))
            .first()
        )
        selected_settings = _plant_settings(selected_plant.id)

    return render_template(
        "dashboard.html",
        plants=plants,
        selected_plant=selected_plant,
        latest_reading=latest_reading,
        selected_settings=selected_settings,
    )


@app.route("/settings", methods=["GET", "POST"])
def settings_page():
    plants = Plant.query.order_by(Plant.plant_name.asc()).all()
    selected_plant_id = request.values.get("plant_id", "").strip()
    if not selected_plant_id and plants:
        selected_plant_id = plants[0].plant_id

    message = ""
    message_type = ""
    selected_plant = Plant.query.filter_by(plant_id=selected_plant_id).first() if selected_plant_id else None

    if request.method == "POST" and selected_plant:
        try:
            start_threshold = float(request.form.get("start_threshold", ""))
            stop_threshold = float(request.form.get("stop_threshold", ""))
        except ValueError:
            message = "Threshold values must be numeric."
            message_type = "error"
        else:
            validation_error = _validate_thresholds(start_threshold, stop_threshold)
            if validation_error:
                message = validation_error
                message_type = "error"
            else:
                settings = _plant_settings(selected_plant.id)
                settings.start_threshold = start_threshold
                settings.stop_threshold = stop_threshold
                db.session.commit()
                message = "Settings saved successfully."
                message_type = "success"

    selected_settings = _plant_settings(selected_plant.id) if selected_plant else None
    if selected_plant:
        db.session.commit()

    return render_template(
        "settings.html",
        plants=plants,
        selected_plant=selected_plant,
        selected_settings=selected_settings,
        message=message,
        message_type=message_type,
    )


if __name__ == "__main__":
    _ensure_tables()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
else:
    _ensure_tables()

