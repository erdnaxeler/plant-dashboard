import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from flask import (
    Flask,
    jsonify,
    request,
    send_from_directory,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc, inspect, text

app = Flask(__name__, static_folder='frontend/dist', static_url_path='')


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

# ml/week by pot size (row) x watering group (column) - indoor presets
WATERING_TABLE_ML_WEEK: dict[str, dict[str, int]] = {
    "5.5x4.5": {"daily": 200, "twice_weekly": 200, "weekly": 150},
    "8x7": {"daily": 400, "twice_weekly": 350, "weekly": 250},
    "9.5x8.5": {"daily": 550, "twice_weekly": 450, "weekly": 350},
    "12x11": {"daily": 800, "twice_weekly": 650, "weekly": 500},
}

POT_SIZES = tuple(WATERING_TABLE_ML_WEEK.keys())

WATERING_GROUP_EVENTS_PER_WEEK = {
    "daily": 7,
    "twice_weekly": 2,
    "weekly": 1,
}

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
    next_watering_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # NOTE: kept for backward-compatible schema/migrations only. No longer
    # read or written anywhere in the scheduling logic (see CHANGE 1).
    auto_watering_triggered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    watering_armed = db.Column(db.Boolean, nullable=False, default=False)
    manual_water_trigger = db.Column(db.Boolean, nullable=False, default=False)
    pump_test_mode = db.Column(db.Boolean, nullable=False, default=False)
    preferred_watering_hour_utc = db.Column(db.Integer, nullable=True)
    # Timezone of the plants' physical location (e.g. "America/New_York").
    # Location-bound, not user-bound - should NOT change when the user
    # travels, only if the plants move. Used for (a) the dashboard's
    # local<->UTC hour conversion and (b) _local_date / same-day dedup.
    timezone = db.Column(db.String(64), nullable=True, default="UTC")
    last_device_ping_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # Map view positioning
    map_x = db.Column(db.Float, nullable=True)
    map_y = db.Column(db.Float, nullable=True)
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
    # Which plant node received this watering. Set per-plant so history follows
    # the plant across waterer changes. Null for device-level rows (no plants
    # connected) and legacy rows logged before per-plant attribution existed.
    plant_ref = db.Column(db.Integer, db.ForeignKey("map_object.id"), nullable=True, index=True)
    ml = db.Column(db.Float, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class MapObject(db.Model):
    """Visual objects on the map editor canvas (plants and waterers)."""
    
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(32), nullable=False, index=True)  # 'plant' or 'waterer'
    name = db.Column(db.String(128), nullable=False, default="Object")
    map_x = db.Column(db.Float, nullable=False, default=0.0)
    map_y = db.Column(db.Float, nullable=False, default=0.0)
    cluster_id = db.Column(db.Integer, db.ForeignKey("cluster.id"), nullable=True, index=True)
    
    # Plant-specific properties (independent of cluster)
    plant_type_id = db.Column(db.Integer, db.ForeignKey("catalog_plant.id"), nullable=True)  # Reference to CatalogPlant
    plant_nickname = db.Column(db.String(128), nullable=True)  # Optional custom nickname
    plant_pot_size = db.Column(db.String(32), nullable=True)  # Actual pot size of this plant
    plant_watering_schedule = db.Column(db.String(32), nullable=True)  # Preferred schedule (daily/twice_weekly/weekly)
    plant_watering_amount = db.Column(db.Float, nullable=True)  # Preferred ml per watering
    
    # Waterer-specific properties (independent of cluster)
    waterer_optimized_pot_size = db.Column(db.String(32), nullable=True)  # What pot size this waterer is optimized for
    waterer_schedule = db.Column(db.String(32), nullable=True)  # Watering schedule this waterer provides
    
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Connection(db.Model):
    """Lines connecting MapObjects on the canvas."""
    
    id = db.Column(db.Integer, primary_key=True)
    from_object_id = db.Column(db.Integer, db.ForeignKey("map_object.id"), nullable=False, index=True)
    to_object_id = db.Column(db.Integer, db.ForeignKey("map_object.id"), nullable=False, index=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


# ---------------- HELPERS ----------------


def _ensure_tables():
    with app.app_context():
        db.create_all()
        _migrate_cluster_columns()
        _seed_catalog_plants()


def _migrate_cluster_columns():
    """Add columns to existing Railway/Postgres DBs (create_all does not alter tables)."""
    try:
        insp = inspect(db.engine)
        
        # Migrate MapObject columns
        if "map_object" in insp.get_table_names():
            map_obj_cols = {c["name"] for c in insp.get_columns("map_object")}
            dialect = db.engine.dialect.name
            
            if "plant_pot_size" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS plant_pot_size VARCHAR(32)"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN plant_pot_size VARCHAR(32)"))
                db.session.commit()
            
            if "plant_watering_schedule" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS plant_watering_schedule VARCHAR(32)"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN plant_watering_schedule VARCHAR(32)"))
                db.session.commit()
            
            if "plant_watering_amount" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS plant_watering_amount FLOAT"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN plant_watering_amount FLOAT"))
                db.session.commit()
            
            if "waterer_optimized_pot_size" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS waterer_optimized_pot_size VARCHAR(32)"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN waterer_optimized_pot_size VARCHAR(32)"))
                db.session.commit()
            
            if "waterer_schedule" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS waterer_schedule VARCHAR(32)"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN waterer_schedule VARCHAR(32)"))
                db.session.commit()

            if "plant_type_id" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS plant_type_id INTEGER"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN plant_type_id INTEGER"))
                db.session.commit()

            if "plant_nickname" not in map_obj_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN IF NOT EXISTS plant_nickname VARCHAR(128)"))
                else:
                    db.session.execute(text("ALTER TABLE map_object ADD COLUMN plant_nickname VARCHAR(128)"))
                db.session.commit()

        # Migrate WateringLog: per-plant attribution so history follows the plant.
        if "watering_log" in insp.get_table_names():
            dialect = db.engine.dialect.name
            wl_cols = {c["name"] for c in insp.get_columns("watering_log")}
            if "plant_ref" not in wl_cols:
                if dialect == "postgresql":
                    db.session.execute(text("ALTER TABLE watering_log ADD COLUMN IF NOT EXISTS plant_ref INTEGER"))
                else:
                    db.session.execute(text("ALTER TABLE watering_log ADD COLUMN plant_ref INTEGER"))
                db.session.commit()

        # Migrate Cluster columns
        if "cluster" not in insp.get_table_names():
            return
        col_names = {c["name"] for c in insp.get_columns("cluster")}

        dialect = db.engine.dialect.name

        if "watering_armed" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "watering_armed BOOLEAN NOT NULL DEFAULT FALSE"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN watering_armed "
                    "BOOLEAN NOT NULL DEFAULT 0"
                ))
            db.session.commit()
            Cluster.query.filter(Cluster.last_watering_at.isnot(None)).update(
                {Cluster.watering_armed: True}, synchronize_session=False
            )
            db.session.commit()

        if "manual_water_trigger" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "manual_water_trigger BOOLEAN NOT NULL DEFAULT FALSE"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN manual_water_trigger "
                    "BOOLEAN NOT NULL DEFAULT 0"
                ))
            db.session.commit()

        if "pump_test_mode" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "pump_test_mode BOOLEAN NOT NULL DEFAULT FALSE"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN pump_test_mode "
                    "BOOLEAN NOT NULL DEFAULT 0"
                ))
            db.session.commit()

        if "preferred_watering_hour_utc" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "preferred_watering_hour_utc INTEGER"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN preferred_watering_hour_utc INTEGER"
                ))
            db.session.commit()

        if "timezone" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "timezone VARCHAR(64) DEFAULT 'UTC'"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN timezone VARCHAR(64) DEFAULT 'UTC'"
                ))
            db.session.commit()

        if "next_watering_at" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "next_watering_at TIMESTAMP WITH TIME ZONE"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN next_watering_at DATETIME"
                ))
            db.session.commit()

        if "auto_watering_triggered_at" not in col_names:
            if dialect == "postgresql":
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                    "auto_watering_triggered_at TIMESTAMP WITH TIME ZONE"
                ))
            else:
                db.session.execute(text(
                    "ALTER TABLE cluster ADD COLUMN auto_watering_triggered_at DATETIME"
                ))
            db.session.commit()
        
        if "map_x" not in col_names:
            if dialect == "postgresql":
                db.session.execute(
                    text(
                        "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                        "map_x FLOAT"
                    )
                )
            else:
                db.session.execute(
                    text(
                        "ALTER TABLE cluster ADD COLUMN map_x FLOAT"
                    )
                )
            db.session.commit()
        
        if "map_y" not in col_names:
            if dialect == "postgresql":
                db.session.execute(
                    text(
                        "ALTER TABLE cluster ADD COLUMN IF NOT EXISTS "
                        "map_y FLOAT"
                    )
                )
            else:
                db.session.execute(
                    text(
                        "ALTER TABLE cluster ADD COLUMN map_y FLOAT"
                    )
                )
            db.session.commit()
    except Exception:
        db.session.rollback()


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
        db.session.add(CatalogPlant(name=name, watering_group=group, sort_order=order))
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
        return _as_utc(parsed)
    except Exception:
        return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalize DB datetimes (often naive on SQLite) to UTC-aware."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cluster_zoneinfo(cluster: "Cluster") -> ZoneInfo:
    """Resolve a cluster's timezone string to a ZoneInfo, falling back to
    UTC for any invalid/unknown zone name."""
    tz_name = (cluster.timezone or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("UTC")


def _local_date(cluster: "Cluster", instant: datetime):
    """Convert a UTC-aware instant to the calendar date in the cluster's
    local timezone (the plants' physical location). This is the single
    place "what day is it for this cluster" is decided."""
    instant = _as_utc(instant) or _utc_now()
    tz = _cluster_zoneinfo(cluster)
    return instant.astimezone(tz).date()


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


# Global scale on all delivered watering volume. Field testing showed the
# baseline table massively overwaters, so every dose is scaled to this
# fraction of the table value. Applied in the volume calc (not stored), so it
# takes effect for existing and new clusters alike. Tune here.
WATERING_DOSE_FACTOR = 0.20


def _effective_ml_per_week(cluster: Cluster) -> float:
    if cluster.baseline_ml_per_week is None:
        return 0.0
    plant_count = len(cluster.catalog_plants) or 1
    return round(
        cluster.baseline_ml_per_week * plant_count * (cluster.ml_volume_pct / 100.0) * WATERING_DOSE_FACTOR,
        2,
    )


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


def _log_watering(cluster: Cluster, ml: float, when: datetime) -> None:
    """Record a watering event. One row per connected plant (so each plant's
    history follows it across waterer changes); a single device-level row
    (plant_ref null) when no plants are attached."""
    plants = MapObject.query.filter_by(cluster_id=cluster.id, type="plant").all()
    if plants:
        for p in plants:
            db.session.add(WateringLog(cluster_ref=cluster.id, plant_ref=p.id, ml=ml, created_at=when))
    else:
        db.session.add(WateringLog(cluster_ref=cluster.id, ml=ml, created_at=when))


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


def _calculate_next_watering_time(cluster: Cluster, from_time: datetime, skip_interval: bool = False) -> datetime:
    """
    Calculate the next watering time from a given starting point.

    Two-stage approach: first decide WHICH DAY to water, then decide WHAT
    TIME on that day.

    STAGE 1 (day): if `from_time` (last watering) falls on the same LOCAL
    calendar day as `now` (per cluster.timezone), the cluster has already
    watered today -> the next watering day is from_time's day + one
    interval-worth of days. Otherwise (from_time was a previous day, or
    there's no prior watering), today is a valid watering day.

    STAGE 2 (time): once the day is fixed, place
    preferred_watering_hour_utc on that day. If that computed instant is
    already at/before `now` (e.g. today's slot already passed), roll
    forward one day - this naturally handles the "overdue" case without
    needing a separate interval-floor check.

    This replaces the old approach of adding a flat one-interval floor
    before snapping to the preferred hour, which had a real bug: a manual
    watering just 30 minutes after the usual time would push the floor
    past that day's preferred-hour slot, costing a full extra day instead
    of the 30 minutes actually lost.
    """
    interval = _interval_for_group(cluster.watering_group)
    from_time = _as_utc(from_time) or _utc_now()
    now = _utc_now()

    if skip_interval:
        # Manual watering: from_time is "now" by construction. Just find
        # the next occurrence of the preferred hour after from_time.
        if cluster.preferred_watering_hour_utc is None:
            return from_time + interval
        candidate = from_time.replace(hour=cluster.preferred_watering_hour_utc, minute=0, second=0, microsecond=0)
        if candidate <= from_time:
            candidate += timedelta(days=1)
        return candidate

    if cluster.preferred_watering_hour_utc is None:
        # No preferred hour set: simple interval from last watering. The
        # day-based logic below doesn't apply without a fixed hour to pin to.
        return from_time + interval

    # STAGE 1: which local day should the next watering land on?
    watered_today = _local_date(cluster, from_time) == _local_date(cluster, now)
    if watered_today:
        days_to_add = max(1, round(interval.total_seconds() / 86400))
        next_day = _local_date(cluster, from_time) + timedelta(days=days_to_add)
    else:
        next_day = _local_date(cluster, now)

    # STAGE 2: place preferred_watering_hour_utc on that local day. Anchor
    # via local midnight on next_day (DST-safe), then set the UTC hour.
    tz = _cluster_zoneinfo(cluster)
    local_midnight = datetime(next_day.year, next_day.month, next_day.day, 0, 0, 0, tzinfo=tz)
    local_midnight_utc = local_midnight.astimezone(timezone.utc)
    candidate = local_midnight_utc.replace(
        hour=cluster.preferred_watering_hour_utc, minute=0, second=0, microsecond=0
    )

    # If that slot is already at/before now (e.g. today's slot already
    # passed, or the cluster is overdue from being paused), roll forward
    # one day. This subsumes the old separate "overdue" guard.
    if candidate <= now:
        candidate += timedelta(days=1)

    return candidate


def _is_watering_time_now(cluster: Cluster, now: datetime) -> bool:
    """Check if NOW is within the 5-minute window of next_watering_at."""
    if cluster.next_watering_at is None:
        return False
    next_time = _as_utc(cluster.next_watering_at)
    if next_time is None:
        return False
    window_end = next_time + timedelta(minutes=5)
    return next_time <= now <= window_end


def _already_watered_today(cluster: Cluster, now: datetime) -> bool:
    """
    CHANGE 3/4: Replacement for the old 1-hour rolling safety interval.
    Returns True if cluster.last_watering_at falls on the same LOCAL
    calendar date as `now`, using the cluster's own timezone (_local_date).
    Covers both auto-watering and manual watering, since
    log-manual-watering also sets last_watering_at = now.
    """
    if cluster.last_watering_at is None:
        return False
    last = _as_utc(cluster.last_watering_at)
    if last is None:
        return False
    return _local_date(cluster, last) == _local_date(cluster, now)


def _cluster_timer_payload(cluster: Cluster, now: Optional[datetime] = None) -> dict[str, Any]:
    """
    CORE WATERING LOGIC.

    CHANGE 1: auto_watering_triggered_at guard removed entirely.
    CHANGE 3/4: 1-hour safety interval replaced with _already_watered_today
    (local calendar date via cluster.timezone).
    """
    now = _as_utc(now) or _utc_now()
    out: dict[str, Any] = {
        "cluster_public_id": cluster.public_id,
        "is_calibrated": cluster.is_calibrated,
        "watering_armed": bool(cluster.watering_armed),
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
        "next_watering_at": (
            cluster.next_watering_at.isoformat() if cluster.next_watering_at else None
        ),
        "pump_test_mode": bool(cluster.pump_test_mode),
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

    if not cluster.watering_armed:
        out["water_due"] = False
        out["run_segments_ms"] = []
        out["fault"] = None
        out["flow_ml_per_min_assumed"] = _flow_ml_per_min_for_cluster(cluster)
        return out

    # CHANGE 1: auto_watering_triggered_at guard removed (was here previously).

    is_time_now = _is_watering_time_now(cluster, now)
    if not is_time_now:
        out["water_due"] = False
        out["run_segments_ms"] = []
        out["fault"] = None
        out["flow_ml_per_min_assumed"] = _flow_ml_per_min_for_cluster(cluster)
        return out

    # CHANGE 3/4: already-watered-today check (local calendar date)
    if _already_watered_today(cluster, now):
        cluster.next_watering_at = _calculate_next_watering_time(cluster, cluster.last_watering_at)
        db.session.commit()
        out["water_due"] = False
        out["run_segments_ms"] = []
        out["fault"] = None
        out["flow_ml_per_min_assumed"] = _flow_ml_per_min_for_cluster(cluster)
        out["next_watering_at"] = cluster.next_watering_at.isoformat()
        return out

    ml_ev = _ml_per_event(cluster)
    flow = _flow_ml_per_min_for_cluster(cluster)
    segs = _run_segments_ms(ml_ev, flow) if ml_ev > 0 else []

    out["water_due"] = True
    out["run_segments_ms"] = segs
    out["fault"] = None
    out["flow_ml_per_min_assumed"] = flow
    return out


def _cluster_status_message(cluster: Cluster) -> str:
    if cluster.device_status == "fault_pump_max":
        return "Device disconnected: max pump time exceeded"
    if cluster.is_calibrated and not cluster.watering_armed:
        if not cluster.device_token:
            return "Calibrated - pair device, then tap Start watering"
        return "Schedule paused - tap Start watering in the app"
    if cluster.device_token and cluster.device_status == "ok":
        if cluster.is_calibrated and cluster.watering_armed:
            if cluster.next_watering_at is None:
                return "Armed - first watering on next device check"
            next_at = _as_utc(cluster.next_watering_at)
            if next_at and _utc_now() < next_at:
                return f"Armed - next watering {next_at.strftime('%Y-%m-%d %H:%M')} UTC"
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

    # AUTO-INITIALIZE next_watering_at if null and calibrated. Uses
    # _calculate_next_watering_time, which always rolls forward to a
    # future slot, so this can't produce a past timestamp.
    if c.is_calibrated and c.next_watering_at is None and c.watering_group:
        base_time = c.last_watering_at if c.last_watering_at else _utc_now()
        c.next_watering_at = _calculate_next_watering_time(c, base_time)
        db.session.commit()

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
        "watering_armed": bool(c.watering_armed),
        "pump_test_mode": bool(c.pump_test_mode),
        "preferred_watering_hour_utc": c.preferred_watering_hour_utc,
        "timezone": c.timezone or "UTC",
        "next_watering_at": (
            c.next_watering_at.isoformat() if c.next_watering_at else None
        ),
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
        "map_x": c.map_x,
        "map_y": c.map_y,
    }


# ---------------- ROUTES ----------------


@app.route("/")
def home():
    """Serve React app for root and all non-API routes."""
    import os
    print(f"[DEBUG] static_folder: {app.static_folder}")
    print(f"[DEBUG] static_folder exists: {os.path.exists(app.static_folder)}")
    if os.path.exists(app.static_folder):
        print(f"[DEBUG] Contents: {os.listdir(app.static_folder)}")
    return send_from_directory(app.static_folder, 'index.html')


@app.route("/<path:path>")
def catch_all(path):
    """Catch-all route for React Router - serve index.html for non-API routes."""
    # If path starts with 'api', let Flask handle it (404 or actual route)
    if path.startswith('api/'):
        return jsonify({"error": "not found"}), 404
    
    # For all other paths, serve the React app
    return send_from_directory(app.static_folder, 'index.html')


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
    return jsonify({
        "start_threshold": settings.start_threshold,
        "stop_threshold": settings.stop_threshold,
    })


@app.route("/api/device/pair", methods=["POST"])
def device_pair():
    """Link a physical device to a cluster using a short-lived pairing code."""
    try:
        payload = request.get_json(silent=True) or {}
        raw = payload.get("pairing_code", "")
        code = "".join(ch for ch in str(raw).strip().upper() if ch.isdigit())
        if len(code) != 6:
            return jsonify({"error": "pairing_code must be 6 digits"}), 400

        now = _utc_now()
        cluster = Cluster.query.filter_by(pairing_code=code).first()
        if not cluster:
            return jsonify({"error": "invalid or expired pairing code"}), 400

        expires = _as_utc(cluster.pairing_expires_at)
        if not expires or expires < now:
            return jsonify({"error": "invalid or expired pairing code"}), 400

        if cluster.device_token:
            return jsonify({"error": "cluster already paired"}), 400

        token = secrets.token_hex(32)
        cluster.device_token = token
        cluster.pairing_code = None
        cluster.pairing_expires_at = None
        cluster.device_status = "ok"
        db.session.commit()

        return jsonify({
            "ok": True,
            "device_token": token,
            "cluster_public_id": cluster.public_id,
        })
    except Exception as exc:
        db.session.rollback()
        app.logger.exception("device_pair failed")
        return jsonify({"error": "pairing failed", "detail": str(exc)}), 500


@app.route("/api/build")
def api_build():
    """Lets you verify Railway is running the latest app (check after deploy)."""
    return jsonify({"build": "2026-06-20-watering-fixes-v1"})


@app.route("/api/device/timer/state", methods=["GET"])
def device_timer_state():
    cluster = _cluster_from_bearer()
    if not cluster:
        return jsonify({"error": "Unauthorized"}), 401
    cluster.last_device_ping_at = _utc_now()
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
        cluster.watering_armed = False
        db.session.commit()
        return jsonify({"ok": True, "device_status": cluster.device_status})

    if cluster.device_status == "fault_pump_max":
        return jsonify({"error": "device fault latched"}), 409

    try:
        ml = float(payload.get("ml", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid ml"}), 400

    now = _utc_now()
    cluster.last_watering_at = now
    cluster.last_watering_ml = round(ml, 2)
    # NOTE: auto_watering_triggered_at clear removed (CHANGE 1) - field is
    # no longer used anywhere in the scheduling flow.

    cluster.next_watering_at = _calculate_next_watering_time(cluster, now)

    if ml > 0:
        _log_watering(cluster, ml, now)

    db.session.commit()
    return jsonify({
        "ok": True,
        "last_watering_at": cluster.last_watering_at.isoformat(),
        "next_watering_at": cluster.next_watering_at.isoformat()
    })


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
    return jsonify([{"time": r.created_at.isoformat(), "moisture": r.moisture} for r in readings])


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


@app.route("/api/app/plants/<int:object_id>/waterings")
def plant_waterings_chart(object_id):
    """Watering history for a single plant node, keyed by plant_ref so it
    follows the plant across waterer changes. Same shape as the cluster chart."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    q = WateringLog.query.filter_by(plant_ref=object_id)
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
        result.append({
            "plant_id": p.plant_id,
            "plant_name": p.plant_name,
            "start_threshold": settings.start_threshold,
            "stop_threshold": settings.stop_threshold,
            "latest_moisture": latest.moisture if latest else None,
            "latest_time": latest.created_at.isoformat() if latest else None,
        })
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
    return jsonify([{"id": r.id, "name": r.name, "watering_group": r.watering_group} for r in rows])


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
    c.watering_armed = False
    if c.device_status != "fault_pump_max":
        c.device_status = "ok" if c.device_token else "not_paired"

    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/start-watering", methods=["POST"])
def api_cluster_start_watering(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "cluster not calibrated"}), 400
    if c.device_status == "fault_pump_max":
        return jsonify({"error": "clear pump fault before starting"}), 400

    c.watering_armed = True

    # _calculate_next_watering_time always rolls forward to a future slot,
    # so even if last_watering_at is stale (cluster paused a long time),
    # this can't land in the past.
    if c.next_watering_at is None:
        if c.last_watering_at:
            c.next_watering_at = _calculate_next_watering_time(c, c.last_watering_at)
        else:
            c.next_watering_at = _calculate_next_watering_time(c, _utc_now())

    if c.device_token and c.device_status != "fault_pump_max":
        c.device_status = "ok"
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/pause-watering", methods=["POST"])
def api_cluster_pause_watering(public_id):
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    c.watering_armed = False
    c.next_watering_at = None
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

    if pct < 0 or pct > 150:
        return jsonify({"error": "ml_volume_pct must be between 0 and 150"}), 400

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
    # Pairing is a link between the physical device and its node — independent
    # of plants/calibration. (Calibration still gates the watering-math
    # endpoints: log-manual-watering, preferred-hour, initialize-schedule.)
    if c.device_token:
        return jsonify({"error": "device already paired; revoke first"}), 400

    for _ in range(20):
        code = f"{secrets.randbelow(10**6):06d}"
        if not Cluster.query.filter_by(pairing_code=code).first():
            c.pairing_code = code
            c.pairing_expires_at = _utc_now() + timedelta(minutes=30)
            db.session.commit()
            return jsonify({
                "pairing_code": code,
                "pairing_expires_at": c.pairing_expires_at.isoformat(),
            })

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
    c.watering_armed = False
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
    c.watering_armed = False
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/toggle-pump-test", methods=["POST"])
def api_cluster_toggle_pump_test(public_id):
    """Toggle pump test mode (on/off for hardware testing)."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.device_token:
        return jsonify({"error": "device not paired"}), 400

    c.pump_test_mode = not c.pump_test_mode
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/log-manual-watering", methods=["POST"])
def api_cluster_log_manual_watering(public_id):
    """Manually log a watering event with the default ml_per_event amount and reset the timer."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "cluster not calibrated"}), 400

    ml = _ml_per_event(c)
    if ml <= 0:
        return jsonify({"error": "no watering amount configured"}), 400

    now = _utc_now()
    _log_watering(c, ml, now)
    c.last_watering_at = now
    c.last_watering_ml = ml
    c.next_watering_at = _calculate_next_watering_time(c, now, skip_interval=True)
    db.session.commit()

    return jsonify({
        "ok": True,
        "ml": ml,
        "logged_at": now.isoformat(),
        "next_watering_at": c.next_watering_at.isoformat()
    })


@app.route("/api/app/clusters/<public_id>/preferred-hour", methods=["PUT"])
def api_cluster_preferred_hour(public_id):
    """Set the preferred watering hour (in UTC). Set to null to disable time preference."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "cluster not calibrated"}), 400

    payload = request.get_json() or {}
    hour = payload.get("preferred_watering_hour_utc")

    if hour is None:
        c.preferred_watering_hour_utc = None
        db.session.commit()
        return jsonify(_serialize_cluster(c))

    try:
        hour = int(hour)
    except (TypeError, ValueError):
        return jsonify({"error": "preferred_watering_hour_utc must be an integer or null"}), 400

    if hour < 0 or hour > 23:
        return jsonify({"error": "preferred_watering_hour_utc must be between 0 and 23"}), 400

    c.preferred_watering_hour_utc = hour
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/timezone", methods=["PUT"])
def api_cluster_timezone(public_id):
    """
    Set the timezone for a cluster. Now load-bearing (not cosmetic) - used
    by the dashboard's local<->UTC hour conversion and by the backend's
    _local_date / _already_watered_today same-day dedup check.
    """
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    payload = request.get_json() or {}
    tz = payload.get("timezone", "UTC").strip()

    if len(tz) > 64:
        return jsonify({"error": "timezone name too long"}), 400

    # Validate it's a real IANA zone name - reject garbage at write time
    # rather than silently falling back to UTC later during scheduling.
    try:
        ZoneInfo(tz or "UTC")
    except Exception:
        return jsonify({"error": "invalid timezone name"}), 400

    c.timezone = tz or "UTC"
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/rename", methods=["PUT"])
def api_cluster_rename(public_id):
    """Rename a cluster."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    payload = request.get_json() or {}
    name = payload.get("name", "").strip()

    if not name:
        return jsonify({"error": "name cannot be empty"}), 400

    c.name = name
    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/position", methods=["PUT"])
def api_cluster_position(public_id):
    """Update cluster position on map view."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404

    payload = request.get_json() or {}

    try:
        x = payload.get("map_x")
        y = payload.get("map_y")

        # Allow null to clear position
        if x is None and y is None:
            c.map_x = None
            c.map_y = None
        else:
            c.map_x = float(x) if x is not None else c.map_x
            c.map_y = float(y) if y is not None else c.map_y
    except (TypeError, ValueError):
        return jsonify({"error": "invalid map coordinates"}), 400

    db.session.commit()
    return jsonify(_serialize_cluster(c))


@app.route("/api/app/clusters/<public_id>/initialize-schedule", methods=["POST"])
def api_cluster_initialize_schedule(public_id):
    """Calculate and set next_watering_at based on last_watering_at."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    c = Cluster.query.filter_by(public_id=public_id).first()
    if not c:
        return jsonify({"error": "not found"}), 404
    if not c.is_calibrated:
        return jsonify({"error": "cluster not calibrated"}), 400

    # _calculate_next_watering_time always rolls forward to a future slot,
    # so this can't land in the past even if last_watering_at is stale.
    base_time = c.last_watering_at if c.last_watering_at else _utc_now()
    c.next_watering_at = _calculate_next_watering_time(c, base_time)
    db.session.commit()

    return jsonify({
        "ok": True,
        "next_watering_at": c.next_watering_at.isoformat(),
        "calculated_from": "last_watering_at" if c.last_watering_at else "now"
    })


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


@app.route("/api/app/clusters/export", methods=["GET"])
def api_clusters_export():
    """Export all cluster data as JSON for backup."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    clusters = Cluster.query.all()
    export_data = []
    for c in clusters:
        logs = WateringLog.query.filter_by(cluster_ref=c.id).order_by(WateringLog.created_at.desc()).limit(100).all()
        export_data.append({
            "cluster": _serialize_cluster(c),
            "watering_logs": [
                {"ml": log.ml, "created_at": log.created_at.isoformat()} for log in logs
            ]
        })

    return jsonify({"exported_at": _utc_now().isoformat(), "clusters": export_data})


@app.route("/api/app/clusters/import", methods=["POST"])
def api_clusters_import():
    """Import cluster data from JSON backup."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json() or {}
    clusters_data = payload.get("clusters", [])

    imported = 0
    for item in clusters_data:
        cluster_data = item.get("cluster", {})
        existing = Cluster.query.filter_by(public_id=cluster_data.get("public_id")).first()
        if existing:
            continue

        c = Cluster(
            public_id=cluster_data.get("public_id"),
            name=cluster_data.get("name", "Imported Cluster"),
            pot_size=cluster_data.get("pot_size"),
            watering_group=cluster_data.get("watering_group"),
            baseline_ml_per_week=cluster_data.get("baseline_ml_per_week"),
            ml_volume_pct=cluster_data.get("ml_volume_pct", 100.0),
            is_calibrated=cluster_data.get("is_calibrated", False),
            watering_armed=cluster_data.get("watering_armed", False),
            last_watering_at=datetime.fromisoformat(cluster_data["last_watering_at"]) if cluster_data.get("last_watering_at") else None,
            last_watering_ml=cluster_data.get("last_watering_ml"),
        )
        db.session.add(c)
        db.session.flush()

        plant_ids = [p["id"] for p in cluster_data.get("catalog_plants", [])]
        if plant_ids:
            plants = CatalogPlant.query.filter(CatalogPlant.id.in_(plant_ids)).all()
            for p in plants:
                c.catalog_plants.append(p)

        imported += 1

    db.session.commit()
    return jsonify({"ok": True, "imported_count": imported})


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


# ---------------- MAP OBJECTS & CONNECTIONS ----------------


def _serialize_map_object(obj: MapObject) -> dict[str, Any]:
    """Serialize a MapObject for API responses."""
    result = {
        "id": obj.id,
        "type": obj.type,
        "name": obj.name,
        "map_x": obj.map_x,
        "map_y": obj.map_y,
        "cluster_id": obj.cluster_id,
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
        "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
    }
    
    # Include plant-specific properties
    if obj.type == "plant":
        result["plant_type_id"] = obj.plant_type_id
        result["plant_nickname"] = obj.plant_nickname
        result["plant_pot_size"] = obj.plant_pot_size
        result["plant_watering_schedule"] = obj.plant_watering_schedule
        result["plant_watering_amount"] = obj.plant_watering_amount
        
        # Task #3: Compute display name as nickname || plant_type_name
        if obj.plant_nickname:
            result["name"] = obj.plant_nickname
        elif obj.plant_type_id:
            catalog_plant = db.session.query(CatalogPlant).filter_by(id=obj.plant_type_id).first()
            if catalog_plant:
                result["name"] = catalog_plant.name
    
    # Include waterer-specific properties
    if obj.type == "waterer":
        result["waterer_optimized_pot_size"] = obj.waterer_optimized_pot_size
        result["waterer_schedule"] = obj.waterer_schedule
    
    return result


def _serialize_connection(conn: Connection) -> dict[str, Any]:
    """Serialize a Connection for API responses."""
    return {
        "id": conn.id,
        "from_object_id": conn.from_object_id,
        "to_object_id": conn.to_object_id,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
    }


def _find_connected_objects(waterer_id: int) -> tuple[Optional[MapObject], list[MapObject]]:
    """
    Find all objects connected to a waterer.
    Returns (waterer, list_of_plants).
    """
    waterer = MapObject.query.filter_by(id=waterer_id, type="waterer").first()
    if not waterer:
        return None, []
    
    # Find all connections involving this waterer
    connections = Connection.query.filter(
        (Connection.from_object_id == waterer_id) | 
        (Connection.to_object_id == waterer_id)
    ).all()
    
    # Extract connected plant IDs
    plant_ids = set()
    for conn in connections:
        other_id = conn.to_object_id if conn.from_object_id == waterer_id else conn.from_object_id
        plant_ids.add(other_id)
    
    # Get all connected plants
    plants = MapObject.query.filter(
        MapObject.id.in_(plant_ids),
        MapObject.type == "plant"
    ).all() if plant_ids else []
    
    return waterer, plants


def _update_cluster_from_connections(waterer_id: int) -> Optional[str]:
    """
    Update cluster assignments based on connections to a waterer.
    Returns error message if validation fails, None on success.
    """
    waterer, plants = _find_connected_objects(waterer_id)

    if not waterer:
        return "Waterer not found"

    # The waterer owns a persistent device record (its cluster). It is created
    # with the waterer and never deleted on disconnect — connecting/disconnecting
    # plants only attaches or detaches them, so pairing/calibration/history
    # survive plant changes. (Fallback-create here for waterers that predate
    # creation-time provisioning.)
    cluster = Cluster.query.get(waterer.cluster_id) if waterer.cluster_id else None
    if not cluster:
        cluster = Cluster(name=waterer.name, is_calibrated=False)
        db.session.add(cluster)
        db.session.flush()
        waterer.cluster_id = cluster.id

    # Re-sync attached plants using ORM objects. (A bulk UPDATE to clear then
    # re-set cluster_id desyncs the session: re-setting an already-attached
    # plant to its stale value is a no-op to the dirty-check, so the cleared
    # row never gets restored and the plant silently falls off.) Detach only
    # the plants on this device that are no longer connected.
    connected_ids = {p.id for p in plants}
    for existing in MapObject.query.filter_by(cluster_id=cluster.id, type="plant").all():
        if existing.id not in connected_ids:
            existing.cluster_id = None

    # More than 3 plants is already rejected at connection time; if it ever
    # happens, leave the device alone and just don't over-attach.
    if len(plants) > 3:
        db.session.commit()
        return None

    for plant in plants:
        plant.cluster_id = cluster.id

    # Auto-calibrate the device from its connected plants (no manual step):
    # adopt the first plant that has both a pot size and a known watering group
    # — that defines the watering math. Other plants stay attached and watered;
    # the frontend flags any whose pot/group differs. No usable plant -> the
    # device stays uncalibrated (nothing to water).
    cluster.catalog_plants.clear()
    pot = group = None
    for plant in plants:
        cp = CatalogPlant.query.get(plant.plant_type_id) if plant.plant_type_id else None
        if cp and cp not in cluster.catalog_plants:
            cluster.catalog_plants.append(cp)
        if pot is None and plant.plant_pot_size in WATERING_TABLE_ML_WEEK \
                and cp and cp.watering_group in WATERING_GROUP_EVENTS_PER_WEEK:
            pot, group = plant.plant_pot_size, cp.watering_group

    if pot and group:
        cluster.pot_size, cluster.watering_group = pot, group
        cluster.baseline_ml_per_week = float(WATERING_TABLE_ML_WEEK[pot][group])
        cluster.is_calibrated = True
    else:
        cluster.pot_size = cluster.watering_group = cluster.baseline_ml_per_week = None
        cluster.is_calibrated = False

    db.session.commit()
    return None


@app.route("/api/app/map-objects", methods=["GET"])
def api_map_objects_list():
    """List all map objects."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    objects = MapObject.query.order_by(MapObject.created_at.asc()).all()
    return jsonify([_serialize_map_object(obj) for obj in objects])


@app.route("/api/app/map-objects/<int:object_id>", methods=["GET"])
def api_map_objects_get(object_id):
    """Get a single map object by ID."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    obj = MapObject.query.get(object_id)
    if not obj:
        return jsonify({"error": "not found"}), 404
    
    return jsonify(_serialize_map_object(obj))


@app.route("/api/app/map-objects", methods=["POST"])
def api_map_objects_create():
    """Create a new map object (plant, waterer, or room)."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    payload = request.get_json() or {}
    
    obj_type = payload.get("type", "").strip().lower()
    if obj_type not in ["plant", "waterer", "room", "garden", "terrace", "furniture"]:
        return jsonify({"error": "type must be 'plant', 'waterer', 'room', 'garden', 'terrace', or 'furniture'"}), 400
    
    name = (payload.get("name") or f"{obj_type.capitalize()}").strip()
    
    try:
        map_x = float(payload.get("x", 0))
        map_y = float(payload.get("y", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid x or y coordinates"}), 400
    
    obj = MapObject(
        type=obj_type,
        name=name,
        map_x=map_x,
        map_y=map_y,
    )
    db.session.add(obj)
    db.session.flush()

    # A waterer node owns a persistent device record (cluster) from birth, so
    # all device controls (pairing, pump test, etc.) are available immediately,
    # independent of whether any plants are connected.
    if obj_type == "waterer":
        cluster = Cluster(name=obj.name, is_calibrated=False)
        db.session.add(cluster)
        db.session.flush()
        obj.cluster_id = cluster.id

    db.session.commit()

    return jsonify(_serialize_map_object(obj)), 201


@app.route("/api/app/map-objects/<int:object_id>", methods=["PUT"])
def api_map_objects_update(object_id):
    """Update a map object's position, name, and type-specific properties."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    obj = MapObject.query.get(object_id)
    if not obj:
        return jsonify({"error": "not found"}), 404
    
    payload = request.get_json() or {}
    
    # Update name if provided
    if "name" in payload:
        name = (payload.get("name") or "Object").strip()
        obj.name = name
    
    # Update position if provided
    try:
        if "x" in payload:
            obj.map_x = float(payload["x"])
        if "y" in payload:
            obj.map_y = float(payload["y"])
    except (TypeError, ValueError):
        return jsonify({"error": "invalid x or y coordinates"}), 400
    
    # Update plant-specific properties
    if obj.type == "plant":
        if "plant_type_id" in payload:
            type_id = payload.get("plant_type_id")
            if type_id is not None:
                # Validate that the catalog plant exists
                catalog_plant = CatalogPlant.query.get(type_id)
                if not catalog_plant:
                    return jsonify({"error": "invalid plant_type_id"}), 400
            obj.plant_type_id = type_id
        
        if "plant_nickname" in payload:
            obj.plant_nickname = payload.get("plant_nickname")
        
        if "plant_pot_size" in payload:
            pot_size = payload.get("plant_pot_size")
            if pot_size and pot_size not in POT_SIZES:
                return jsonify({"error": "invalid pot_size", "allowed": list(POT_SIZES)}), 400
            obj.plant_pot_size = pot_size
        
        if "plant_watering_schedule" in payload:
            schedule = payload.get("plant_watering_schedule")
            if schedule and schedule not in WATERING_GROUP_EVENTS_PER_WEEK:
                return jsonify({"error": "invalid watering_schedule", "allowed": list(WATERING_GROUP_EVENTS_PER_WEEK.keys())}), 400
            obj.plant_watering_schedule = schedule
        
        if "plant_watering_amount" in payload:
            try:
                amount = payload.get("plant_watering_amount")
                obj.plant_watering_amount = float(amount) if amount is not None else None
            except (TypeError, ValueError):
                return jsonify({"error": "invalid watering_amount"}), 400
    
    # Update waterer-specific properties
    if obj.type == "waterer":
        if "waterer_optimized_pot_size" in payload:
            pot_size = payload.get("waterer_optimized_pot_size")
            if pot_size and pot_size not in POT_SIZES:
                return jsonify({"error": "invalid pot_size", "allowed": list(POT_SIZES)}), 400
            obj.waterer_optimized_pot_size = pot_size
        
        if "waterer_schedule" in payload:
            schedule = payload.get("waterer_schedule")
            if schedule and schedule not in WATERING_GROUP_EVENTS_PER_WEEK:
                return jsonify({"error": "invalid schedule", "allowed": list(WATERING_GROUP_EVENTS_PER_WEEK.keys())}), 400
            obj.waterer_schedule = schedule

    db.session.commit()

    # If a connected plant's pot/type changed, re-derive its waterer's
    # auto-calibration so the device's watering math stays in sync.
    if obj.type == "plant" and obj.cluster_id and (
        "plant_type_id" in payload or "plant_pot_size" in payload
    ):
        waterer = MapObject.query.filter_by(cluster_id=obj.cluster_id, type="waterer").first()
        if waterer:
            _update_cluster_from_connections(waterer.id)

    return jsonify(_serialize_map_object(obj))


@app.route("/api/app/map-objects/<int:object_id>", methods=["DELETE"])
def api_map_objects_delete(object_id):
    """Delete a map object and its connections."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    obj = MapObject.query.get(object_id)
    if not obj:
        return jsonify({"error": "not found"}), 404
    
    # Store cluster_id and type before deletion
    cluster_id = obj.cluster_id
    obj_type = obj.type
    
    # Delete all connections involving this object
    Connection.query.filter(
        (Connection.from_object_id == object_id) | 
        (Connection.to_object_id == object_id)
    ).delete(synchronize_session=False)
    
    # Delete the object
    db.session.delete(obj)
    db.session.commit()
    
    # Deleting the waterer node retires its device record. Detach plants,
    # clear its watering history (watering_log.cluster_ref has no ON DELETE,
    # so deleting the cluster first would FK-violate on Postgres), then drop
    # the cluster.
    if obj_type == "waterer" and cluster_id:
        cluster = Cluster.query.get(cluster_id)
        if cluster:
            MapObject.query.filter_by(cluster_id=cluster_id).update(
                {MapObject.cluster_id: None}, synchronize_session=False
            )
            WateringLog.query.filter_by(cluster_ref=cluster_id).delete(synchronize_session=False)
            cluster.catalog_plants.clear()
            db.session.delete(cluster)
            db.session.commit()
    
    return jsonify({"ok": True})


@app.route("/api/app/connections", methods=["GET"])
def api_connections_list():
    """List all connections."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    connections = Connection.query.order_by(Connection.created_at.asc()).all()
    return jsonify([_serialize_connection(conn) for conn in connections])


@app.route("/api/app/connections", methods=["POST"])
def api_connections_create():
    """Create a connection between two map objects."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    payload = request.get_json() or {}
    
    try:
        from_id = int(payload.get("from_object_id"))
        to_id = int(payload.get("to_object_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid from_object_id or to_object_id"}), 400
    
    if from_id == to_id:
        return jsonify({"error": "cannot connect object to itself"}), 400
    
    # Check if objects exist
    from_obj = MapObject.query.get(from_id)
    to_obj = MapObject.query.get(to_id)
    
    if not from_obj or not to_obj:
        return jsonify({"error": "one or both objects not found"}), 404
    
    # Validation: A plant cannot connect to multiple waterers
    plant_obj = None
    waterer_obj = None
    
    if from_obj.type == "plant" and to_obj.type == "waterer":
        plant_obj = from_obj
        waterer_obj = to_obj
    elif from_obj.type == "waterer" and to_obj.type == "plant":
        plant_obj = to_obj
        waterer_obj = from_obj
    
    if plant_obj:
        # Check if this plant is already connected to a waterer
        existing_connections = Connection.query.filter(
            (Connection.from_object_id == plant_obj.id) | 
            (Connection.to_object_id == plant_obj.id)
        ).all()
        
        for conn in existing_connections:
            other_id = conn.to_object_id if conn.from_object_id == plant_obj.id else conn.from_object_id
            other_obj = MapObject.query.get(other_id)
            if other_obj and other_obj.type == "waterer":
                return jsonify({"error": "This plant is already connected to a waterer. Disconnect it first."}), 400
    
    # Validation: A waterer cannot connect to more than 3 plants
    if waterer_obj:
        existing_connections = Connection.query.filter(
            (Connection.from_object_id == waterer_obj.id) | 
            (Connection.to_object_id == waterer_obj.id)
        ).all()
        
        plant_count = 0
        for conn in existing_connections:
            other_id = conn.to_object_id if conn.from_object_id == waterer_obj.id else conn.from_object_id
            other_obj = MapObject.query.get(other_id)
            if other_obj and other_obj.type == "plant":
                plant_count += 1
        
        if plant_count >= 3:
            return jsonify({"error": "A waterer can only connect to a maximum of 3 plants"}), 400
    
    # Check if connection already exists (in either direction)
    existing = Connection.query.filter(
        ((Connection.from_object_id == from_id) & (Connection.to_object_id == to_id)) |
        ((Connection.from_object_id == to_id) & (Connection.to_object_id == from_id))
    ).first()
    
    if existing:
        return jsonify({"error": "connection already exists"}), 400
    
    # Create connection
    conn = Connection(
        from_object_id=from_id,
        to_object_id=to_id,
    )
    db.session.add(conn)
    db.session.commit()
    
    # Update cluster assignments if either object is a waterer
    waterer_id = None
    if from_obj.type == "waterer":
        waterer_id = from_id
    elif to_obj.type == "waterer":
        waterer_id = to_id
    
    if waterer_id:
        error = _update_cluster_from_connections(waterer_id)
        if error:
            # Rollback connection if cluster validation fails
            db.session.delete(conn)
            db.session.commit()
            return jsonify({"error": error}), 400
    
    return jsonify(_serialize_connection(conn)), 201


@app.route("/api/app/connections/<int:connection_id>", methods=["DELETE"])
def api_connections_delete(connection_id):
    """Delete a connection."""
    if not _require_dashboard_auth():
        return jsonify({"error": "Unauthorized"}), 401
    
    conn = Connection.query.get(connection_id)
    if not conn:
        return jsonify({"error": "not found"}), 404
    
    # Get objects before deletion
    from_obj = MapObject.query.get(conn.from_object_id)
    to_obj = MapObject.query.get(conn.to_object_id)
    
    # Delete connection
    db.session.delete(conn)
    db.session.commit()
    
    # Update cluster assignments if either object is a waterer
    waterer_id = None
    if from_obj and from_obj.type == "waterer":
        waterer_id = from_obj.id
    elif to_obj and to_obj.type == "waterer":
        waterer_id = to_obj.id
    
    if waterer_id:
        _update_cluster_from_connections(waterer_id)
    
    return jsonify({"ok": True})


# ---------------- START ----------------

_ensure_tables()

if __name__ == "__main__":
    app.run(debug=True)