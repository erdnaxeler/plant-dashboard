import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc

app = Flask(__name__)


def _database_url() -> str:
    configured_url = os.getenv("DATABASE_URL", "sqlite:///plant_app.db")
    if configured_url.startswith("postgres://"):
        configured_url = configured_url.replace(
            "postgres://", "postgresql+psycopg2://", 1
        )
    return configured_url


app.config["SQLALCHEMY_DATABASE_URI"] = _database_url()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

# ml/week by pot size (row) × watering group (column) — indoor presets
WATERING_TABLE_ML_WEEK: dict[str, dict[str, int]] = {
    "5.5x4.5": {"daily": 175, "twice_weekly": 300, "weekly": 450},
    "8x7": {"daily": 350, "twice_weekly": 525, "weekly": 800},
    "9.5x8.5": {"daily": 475, "twice_weekly": 700, "weekly": 1000},
    "12x11": {"daily": 750, "twice_weekly": 1050, "weekly": 1450},
}

POT_SIZES = tuple(WATERING_TABLE_ML_WEEK.keys())

WATERING_GROUP_EVENTS_PER_WEEK = {
    "daily": 7,
    "twice_weekly": 2,
    "weekly": 1,
}

# Placeholder flow rates (ml/min) by number of plants on shared pump — replace when measured
PLANT_COUNT_FLOW_ML_PER_MIN: dict[int, float] = {
    1: 30.0,
    2: 22.0,
    3: 18.0,
}

MAX_PUMP_SEGMENT_MS = 60_000

cluster_catalog_association = db.Table(
    "cluster_catalog_plant",
    db.Column("cluster_id", db.Integer, db.ForeignKey("cluster.id"), primary_key=True),
    db.Column(
        "catalog_plant_id",
        db.Integer,
        db.ForeignKey("catalog_plant.id"),
        primary_key=True,
    ),
)


# ---------------- MODELS ----------------


class Plant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    plant_id = db.Column(db.String(128), unique=True, nullable=False, index=True)
    plant_name = db.Column(db.String(128), nullable=False, default="Plant")
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class PlantSetting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    plant_ref = db.Column(db.Integer, db.ForeignKey("plant.id"), unique=True)
    start_threshold = db.Column(db.Float, default=20.0)
    stop_threshold = db.Column(db.Float, default=35.0)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MoistureReading(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    plant_ref = db.Column(db.Integer, db.ForeignKey("plant.id"))
    moisture = db.Column(db.Float)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class CatalogPlant(db.Model):
    """Editable catalog: herbs/plants and their watering rhythm group."""

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    watering_group = db.Column(db.String(32), nullable=False, index=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class Cluster(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    public_id = db.Column(
        db.String(36),
        unique=True,
        nullable=False,
        default=lambda: str(uuid.uuid4()),
        index=True,
    )
    name = db.Column(db.String(128), nullable=False, default="Cluster")
    pot_size = db.Column(db.String(32), nullable=True)
    watering_group = db.Column(db.String(32), nullable=True, index=True)
    baseline_ml_per_week = db.Column(db.Float, nullable=True)
    ml_volume_pct = db.Column(db.Float, nullable=False, default=100.0)
    is_calibrated = db.Column(db.Boolean, nullable=False, default=False)
    device_token = db.Column(db.String(128), unique=True, nullable=True, index=True)
    pairing_code = db.Column(db.String(16), nullable=True, index=True)
    pairing_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    device_status = db.Column(db.String(32), nullable=False, default="not_paired")
    last_watering_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_watering_ml = db.Column(db.Float, nullable=True)
    last_device_ping_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    catalog_plants = db.relationship(
        "CatalogPlant",
        secondary=cluster_catalog_association,
        lazy="joined",
        order_by="CatalogPlant.sort_order",
    )


class WateringLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    cluster_ref = db.Column(db.Integer, db.ForeignKey("cluster.id"), index=True)
    ml = db.Column(db.Float, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


# ---------------- HELPERS ----------------


def _ensure_tables():
    with app.app_context():
        db.create_all()
        _seed_catalog_plants()


def _seed_catalog_plants():
    if CatalogPlant.query.count() > 0:
        return
    rows = [
        ("Basil", "daily", 10),
        ("Peppers", "daily", 20),
        ("Parsley", "daily", 30),
        ("Lavender", "weekly", 40),
        ("Rosemary", "weekly", 50),
        ("Thyme", "weekly", 60),
        ("Sage", "weekly", 70),
    ]
    for name, group, order in rows:
        db.session.add(
            CatalogPlant(name=name, watering_group=group, sort_order=order)
        )
    db.session.commit()


def _validate_thresholds(start_threshold, stop_threshold) -> Optional[str]:
    if start_threshold < 0 or start_threshold > 100:
        return "start_threshold must be between 0 and 100"
    if stop_threshold < 0 or stop_threshold > 100:
        return "stop_threshold must be between 0 and 100"
    if start_threshold >= stop_threshold:
        return "start_threshold must be less than stop_threshold"
    return None


def _parse_timestamp(value):
    if not value:
        return datetime.now(timezone.utc)

    try:
        if isinstance(value, str) and value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _require_device_auth():
    expected_token = os.getenv("DEVICE_API_TOKEN", "").strip()
    if not expected_token:
        return False

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.replace("Bearer ", "").strip() == expected_token

    return False


def _require_dashboard_auth():
    password = os.getenv("DASHBOARD_PASSWORD", "").strip()
    if not password:
        return True

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.replace("Bearer ", "").strip() == password

    return False


def _cluster_from_bearer() -> Optional[Cluster]:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.replace("Bearer ", "", 1).strip()
    if not token:
        return None
    return Cluster.query.filter_by(device_token=token).first()


def _effective_ml_per_week(cluster: Cluster) -> float:
    if cluster.baseline_ml_per_week is None:
        return 0.0
    return round(cluster.baseline_ml_per_week * (cluster.ml_volume_pct / 100.0), 2)


def _events_per_week(group: str) -> int:
    return WATERING_GROUP_EVENTS_PER_WEEK.get(group, 1)


def _ml_per_event(cluster: Cluster) -> float:
    g = cluster.watering_group
    if not g:
        return 0.0
    n = _events_per_week(g)
    if n <= 0:
        return 0.0
    return round(_effective_ml_per_week(cluster) / n, 2)


def _interval_for_group(group: str) -> timedelta:
    n = _events_per_week(group)
    if n <= 0:
        return timedelta(days=7)
    return timedelta(seconds=(7 * 24 * 3600) / n)


def _flow_ml_per_min_for_cluster(cluster: Cluster) -> float:
    count = len(cluster.catalog_plants) or 1
    count = min(max(count, 1), 3)
    return PLANT_COUNT_FLOW_ML_PER_MIN.get(count, PLANT_COUNT_FLOW_ML_PER_MIN[1])


def _run_segments_ms(ml_total: float, flow_ml_per_min: float) -> list[int]:
    """Split pump time into segments capped at MAX_PUMP_SEGMENT_MS."""
    if ml_total <= 0 or flow_ml_per_min <= 0:
        return []
    ml_per_sec = flow_ml_per_min / 60.0
    max_ml_seg = ml_per_sec * (MAX_PUMP_SEGMENT_MS / 1000.0)
    segments: list[int] = []
    remain = ml_total
    guard = 0
    while remain > 0.001 and guard < 500:
        guard += 1
        ml_seg = min(remain, max_ml_seg)
        ms = int((ml_seg / ml_per_sec) * 1000)
        ms = max(1, min(ms, MAX_PUMP_SEGMENT_MS))
        segments.append(ms)
        delivered = (ms / 1000.0) * ml_per_sec
        remain -= delivered
    return segments


def _cluster_timer_payload(cluster: Cluster, now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    out: dict[str, Any] = {
        "cluster_public_id": cluster.public_id,
        "is_calibrated": cluster.is_calibrated,
        "device_status": cluster.device_status,
        "status_message": _cluster_status_message(cluster),
        "watering_group": cluster.watering_group,
        "pot_size": cluster.pot_size,
        "effective_ml_per_week": _effective_ml_per_week(cluster),
        "ml_per_event": _ml_per_event(cluster),
        "last_watering_at": (
            cluster.last_watering_at.isoformat() if cluster.last_watering_at else None
        ),
        "last_watering_ml": cluster.last_watering_ml,
    }

    if cluster.device_status == "fault_pump_max":
        out["water_due"] = False
        out["run_segments_ms"] = []
        out["fault"] = "pump_max"
        return out

    if not cluster.is_calibrated or not cluster.watering_group:
        out["water_due"] = False
        out["run_segments_ms"] = []
        out["fault"] = None
        return out

    interval = _interval_for_group(cluster.watering_group)
    if cluster.last_watering_at is None:
        water_due = True
    else:
        next_due = cluster.last_watering_at + interval
        water_due = now >= next_due

    ml_ev = _ml_per_event(cluster)
    flow = _flow_ml_per_min_for_cluster(cluster)
    segs = _run_segments_ms(ml_ev, flow) if water_due and ml_ev > 0 else []

    out["water_due"] = water_due
    out["run_segments_ms"] = segs
    out["fault"] = None
    out["flow_ml_per_min_assumed"] = flow
    return out


def _cluster_status_message(cluster: Cluster) -> str:
    if cluster.device_status == "fault_pump_max":
        return "Device disconnected: max pump time exceeded"
    if cluster.device_token and cluster.device_status == "ok":
        return "Device connected"
    if cluster.is_calibrated and not cluster.device_token:
        return "Awaiting device pairing"
    if not cluster.is_calibrated:
        return "Not calibrated"
    return cluster.device_status


def _get_or_create_plant(plant_id, plant_name):
    plant = Plant.query.filter_by(plant_id=plant_id).first()

    if plant:
        if plant_name and plant.plant_name != plant_name:
            plant.plant_name = plant_name
        return plant

    plant = Plant(plant_id=plant_id, plant_name=plant_name or plant_id)
    db.session.add(plant)
    db.session.flush()

    db.session.add(PlantSetting(plant_ref=plant.id))
    return plant


def _plant_settings(plant_ref):
    settings = PlantSetting.query.filter_by(plant_ref=plant_ref).first()
    if not settings:
        settings = PlantSetting(plant_ref=plant_ref)
        db.session.add(settings)
        db.session.flush()
    return settings


def _serialize_cluster(c: Cluster) -> dict[str, Any]:
    plants = [
        {"id": p.id, "name": p.name, "watering_group": p.watering_group}
        for p in sorted(c.catalog_plants, key=lambda x: (x.sort_order, x.name))
    ]
    return {
        "id": c.id,
        "public_id": c.public_id,
        "name": c.name,
        "pot_size": c.pot_size,
        "watering_group": c.watering_group,
        "baseline_ml_per_week": c.baseline_ml_per_week,
        "ml_volume_pct": c.ml_volume_pct,
        "effective_ml_per_week": _effective_ml_per_week(c),
        "ml_per_event": _ml_per_event(c),
        "is_calibrated": c.is_calibrated,
        "has_device": bool(c.device_token),
        "device_status": c.device_status,
        "status_message": _cluster_status_message(c),
        "pairing_code": c.pairing_code,
        "pairing_expires_at": (
            c.pairing_expires_at.isoformat() if c.pairing_expires_at else None
        ),
        "last_watering_at": (
            c.last_watering_at.isoformat() if c.last_watering_at else None
        ),
        "last_watering_ml": c.last_watering_ml,
        "last_device_ping_at": (
            c.last_device_ping_at.isoformat() if c.last_device_ping_at else None
        ),
        "catalog_plants": plants,
    }


# ---------------- ROUTES ----------------


@app.route("/")
def home():
    return redirect(url_for("dashboard"))


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/device/telemetry", methods=["POST"])
def device_telemetry():
    if not _require_device_auth():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json() or {}
    plant_id = payload.get("plant_id")

    if not plant_id:
        return jsonify({"error": "plant_id required"}), 400

    try:
        moisture = float(payload.get("moisture"))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid moisture"}), 400

    plant = _get_or_create_plant(plant_id, payload.get("plant_name"))
    _plant_settings(plant.id)

    reading = MoistureReading(
        plant_ref=plant.id,
        moisture=moisture,
        created_at=_parse_timestamp(payload.get("timestamp")),
    )

    db.session.add(reading)
    db.session.commit()

    return jsonify({"ok": True})


@app.route("/api/device/settings")
def device_settings():
    if not _require_device_auth():
        return jsonify({"error": "Unauthorized"}), 401

    plant_id = request.args.get("plant_id")

    plant = _get_or_create_plant(plant_id, None)
    settings = _plant_settings(plant.id)

    return jsonify(
        {
            "start_threshold": settings.start_threshold,
            "stop_threshold": settings.stop_threshold,
        }
    )


@app.route("/api/device/pair", methods=["POST"])
def device_pair():
    """Link a physical device to a cluster using a short-lived pairing code (no prior token)."""
    payload = request.get_json() or {}
    code = (payload.get("pairing_code") or "").strip().upper()
    if not code or len(code) < 6:
        return jsonify({"error": "pairing_code required"}), 400

    now = datetime.now(timezone.utc)
    cluster = Cluster.query.filter_by(pairing_code=code).first()
    if not cluster or not cluster.pairing_expires_at or cluster.pairing_expires_at < now:
        return jsonify({"error": "invalid or expired pairing code"}), 400

    if cluster.device_token:
        return jsonify({"error": "cluster already paired"}), 400

    token = secrets.token_hex(32)
    cluster.device_token = token
    cluster.pairing_code = None
    cluster.pairing_expires_at = None
    cluster.device_status = "ok"
    db.session.commit()

    return jsonify(
        {
            "ok": True,
            "device_token": token,
            "cluster_public_id": cluster.public_id,
        }
    )


@app.route("/api/device/timer/state", methods=["GET"])
def device_timer_state():
    cluster = _cluster_from_bearer()
    if not cluster:
        return jsonify({"error": "Unauthorized"}), 401

    cluster.last_device_ping_at = datetime.now(timezone.utc)
    db.session.commit()

    payload = _cluster_timer_payload(cluster)
    return jsonify(payload)


@app.route("/api/device/timer/complete", methods=["POST"])
def device_timer_complete():
    cluster = _cluster_from_bearer()
    if not cluster:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json() or {}
    fault = (payload.get("fault") or "").strip().lower()

    if fault == "pump_max":
        cluster.device_status = "fault_pump_max"
        db.session.commit()
        return jsonify({"ok": True, "device_status": cluster.device_status})

    if cluster.device_status == "fault_pump_max":
        return jsonify({"error": "device fault latched"}), 409

    try:
        ml = float(payload.get("ml", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid ml"}), 400

    now = datetime.now(timezone.utc)
    if ml > 0:
        cluster.last_watering_at = now
        cluster.last_watering_ml = round(ml, 2)
        db.session.add(WateringLog(cluster_ref=cluster.id, ml=ml, created_at=now))

    db.session.commit()
    return jsonify({"ok": True, "last_watering_at": cluster.last_watering_at.isoformat()})


@app.route("/api/app/chart")
def chart_data():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    plant_id = request.args.get("plant_id")

    plant = Plant.query.filter_by(plant_id=plant_id).first()
    if not plant:
        return jsonify([])

    query = MoistureReading.query.filter_by(plant_ref=plant.id)

    days = request.args.get("days", type=int)
    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(MoistureReading.created_at >= cutoff)

    readings = query.order_by(MoistureReading.created_at.asc()).all()

    return jsonify(
        [{"time": r.created_at.isoformat(), "moisture": r.moisture} for r in readings]
    )


@app.route("/api/app/cluster/<public_id>/waterings")
def cluster_waterings_chart(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    q = WateringLog.query.filter_by(cluster_ref=c.id)
    days = request.args.get("days", type=int)
    if days and days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        q = q.filter(WateringLog.created_at >= cutoff)
    rows = q.order_by(WateringLog.created_at.asc()).all()
    return jsonify([{"time": r.created_at.isoformat(), "ml": r.ml} for r in rows])


@app.route("/api/app/plants")
def api_plants():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    plants = Plant.query.order_by(Plant.plant_name).all()
    result = []

    for p in plants:
        settings = _plant_settings(p.id)
        latest = (
            MoistureReading.query.filter_by(plant_ref=p.id)
            .order_by(desc(MoistureReading.created_at))
            .first()
        )
        result.append(
            {
                "plant_id": p.plant_id,
                "plant_name": p.plant_name,
                "start_threshold": settings.start_threshold,
                "stop_threshold": settings.stop_threshold,
                "latest_moisture": latest.moisture if latest else None,
                "latest_time": latest.created_at.isoformat() if latest else None,
            }
        )

    db.session.commit()
    return jsonify(result)


@app.route("/api/app/catalog-plants")
def api_catalog_plants():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    rows = (
        CatalogPlant.query.filter_by(is_active=True)
        .order_by(CatalogPlant.sort_order, CatalogPlant.name)
        .all()
    )
    return jsonify(
        [
            {"id": r.id, "name": r.name, "watering_group": r.watering_group}
            for r in rows
        ]
    )


@app.route("/api/app/clusters", methods=["GET"])
def api_clusters_list():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    rows = Cluster.query.order_by(Cluster.created_at.desc()).all()
    return jsonify([_serialize_cluster(c) for c in rows])


@app.route("/api/app/clusters", methods=["POST"])
def api_clusters_create():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    payload = request.get_json() or {}
    name = (payload.get("name") or "Cluster").strip() or "Cluster"
    c = Cluster(name=name[:128])
    db.session.add(c)
    db.session.commit()
    return jsonify(_serialize_cluster(c)), 201


@app.route("/api/app/clusters/<public_id>", methods=["GET"])
def api_cluster_get(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/calibrate", methods=["PUT"])
def api_cluster_calibrate(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    payload = request.get_json() or {}
    pot_size = payload.get("pot_size")
    ids = payload.get("catalog_plant_ids") or []

    if pot_size not in WATERING_TABLE_ML_WEEK:
        return jsonify({"error": "invalid pot_size", "allowed": list(POT_SIZES)}), 400

    if not isinstance(ids, list) or not (1 <= len(ids) <= 3):
        return jsonify({"error": "catalog_plant_ids must be a list of 1 to 3 ids"}), 400

    try:
        pid_set = [int(x) for x in ids]
    except (TypeError, ValueError):
        return jsonify({"error": "invalid catalog_plant_ids"}), 400

    plants = CatalogPlant.query.filter(CatalogPlant.id.in_(pid_set)).all()
    if len(plants) != len(pid_set):
        return jsonify({"error": "unknown catalog plant id"}), 400

    groups = {p.watering_group for p in plants}
    if len(groups) != 1:
        return jsonify({"error": "all plants in a cluster must share the same watering group"}), 400

    group = next(iter(groups))
    if group not in WATERING_GROUP_EVENTS_PER_WEEK:
        return jsonify({"error": "invalid plant watering_group in database"}), 400

    baseline = float(WATERING_TABLE_ML_WEEK[pot_size][group])

    c.catalog_plants.clear()
    for p in sorted(plants, key=lambda x: x.sort_order):
        c.catalog_plants.append(p)

    c.pot_size = pot_size
    c.watering_group = group
    c.baseline_ml_per_week = baseline
    c.ml_volume_pct = 100.0
    c.is_calibrated = True
    if c.device_status != "fault_pump_max":
        c.device_status = "ok" if c.device_token else "not_paired"

    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/volume", methods=["PUT"])
def api_cluster_volume(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "cluster not calibrated"}), 400

    payload = request.get_json() or {}
    try:
        pct = float(payload.get("ml_volume_pct", 100))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid ml_volume_pct"}), 400

    if pct < 50 or pct > 150:
        return jsonify({"error": "ml_volume_pct must be between 50 and 150"}), 400

    c.ml_volume_pct = pct
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/pairing-code", methods=["POST"])
def api_cluster_pairing_code(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "calibrate cluster before pairing"}), 400
    if c.device_token:
        return jsonify({"error": "device already paired; revoke first"}), 400

    for _ in range(20):
        code = f"{secrets.randbelow(10**6):06d}"
        if not Cluster.query.filter_by(pairing_code=code).first():
            c.pairing_code = code
            c.pairing_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
            db.session.commit()
            return jsonify(
                {
                    "pairing_code": code,
                    "pairing_expires_at": c.pairing_expires_at.isoformat(),
                }
            )

    return jsonify({"error": "could not allocate pairing code"}), 500


@app.route("/api/app/clusters/<public_id>/unpair", methods=["POST"])
def api_cluster_unpair(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    c.device_token = None
    c.pairing_code = None
    c.pairing_expires_at = None
    c.device_status = "not_paired"
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/clear-fault", methods=["POST"])
def api_cluster_clear_fault(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    c.device_status = "ok" if c.device_token else "not_paired"
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>", methods=["DELETE"])
def api_cluster_delete(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    WateringLog.query.filter_by(cluster_ref=c.id).delete()
    c.catalog_plants.clear()
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/app/settings", methods=["PUT"])
def update_settings():
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json() or {}
    plant_id = payload.get("plant_id")

    if not plant_id:
        return jsonify({"error": "plant_id required"}), 400

    plant = Plant.query.filter_by(plant_id=plant_id).first()
    if not plant:
        return jsonify({"error": "plant not found"}), 404

    try:
        start = float(payload.get("start_threshold"))
        stop = float(payload.get("stop_threshold"))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid threshold values"}), 400

    err = _validate_thresholds(start, stop)
    if err:
        return jsonify({"error": err}), 400

    settings = _plant_settings(plant.id)
    settings.start_threshold = start
    settings.stop_threshold = stop
    db.session.commit()

    return jsonify({"ok": True})


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


# ---------------- START ----------------

_ensure_tables()

if __name__ == "__main__":
    app.run(debug=True)
