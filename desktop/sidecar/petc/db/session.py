"""SQLAlchemy engine + session factory for the local SQLite database."""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Data directory is set by the Electron main process via env var;
# falls back to cwd for dev use.
_DATA_DIR = Path(os.environ.get("PETC_DATA_DIR", "."))
DB_PATH = _DATA_DIR / "petc.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)

# Enable WAL mode for better concurrent read performance
@event.listens_for(engine, "connect")
def _set_wal(dbapi_conn, _):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")
    dbapi_conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create all tables if they don't exist (used in dev; prod uses Alembic)."""
    from . import models  # noqa: F401 — registers all models with Base
    Base.metadata.create_all(bind=engine)
    _additive_sqlite_migrations()
    _seed_dev_operator()
    _seed_default_settings()


def _additive_sqlite_migrations() -> None:
    """Keep dev SQLite files usable while the greenfield schema is still moving."""
    inspector = inspect(engine)
    additions = {
        "users": {
            "tesda_cert_no": "VARCHAR",
            "certification_no": "VARCHAR",
        },
        "vehicles_cache": {
            "mv_no": "VARCHAR",
            "or_type": "VARCHAR",
            "cr_date": "VARCHAR",
            "cr_no": "VARCHAR",
            "district_office": "VARCHAR",
            "series": "VARCHAR",
            "vehicle_type": "VARCHAR",
            "year_model": "INTEGER",
            "color": "VARCHAR",
            "transmission": "VARCHAR",
            "owner_type": "VARCHAR",
            "last_name": "VARCHAR",
            "first_name": "VARCHAR",
            "middle_name": "VARCHAR",
            "organization": "VARCHAR",
            "address": "VARCHAR",
            "city": "VARCHAR",
            "source": "VARCHAR DEFAULT 'LTMS' NOT NULL",
        },
        "ltms_submissions": {
            "payload_json": "TEXT",
            "ltms_reference_no": "VARCHAR",
            "pdf_path": "VARCHAR",
        },
    }

    with engine.begin() as conn:
        for table_name, columns in additions.items():
            if not inspector.has_table(table_name):
                continue
            existing = {col["name"] for col in inspector.get_columns(table_name)}
            for column_name, column_type in columns.items():
                if column_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))


def _seed_default_settings() -> None:
    """Seed analyzer.* settings from env vars on first boot. Subsequent boots
    read whatever the user has saved via the settings page."""
    from .models import AppSetting

    defaults = {
        "analyzer.type": os.environ.get("PETC_ANALYZER", "mock"),
        "analyzer.port": os.environ.get("PETC_ANALYZER_PORT", "COM1"),
        "analyzer.baud": os.environ.get("PETC_ANALYZER_BAUD", "9600"),
        "analyzer.data_bits": os.environ.get("PETC_ANALYZER_DATABITS", "8"),
        "analyzer.parity": os.environ.get("PETC_ANALYZER_PARITY", "N"),
        "analyzer.stop_bits": os.environ.get("PETC_ANALYZER_STOPBITS", "1"),
        "analyzer.address": os.environ.get("PETC_ANALYZER_ADDRESS", "01"),
        "camera.type": os.environ.get("PETC_CAMERA", "mock"),
        "camera.device": os.environ.get("PETC_CAMERA_DEVICE", "0"),
    }
    with SessionLocal() as session:
        for key, value in defaults.items():
            if session.get(AppSetting, key) is None:
                session.add(AppSetting(key=key, value=value))
        session.commit()


def _seed_dev_operator() -> None:
    from .models import User

    with SessionLocal() as session:
        existing = session.get(User, "op1")
        if existing is not None:
            return
        try:
            from passlib.context import CryptContext  # type: ignore
            password_hash = CryptContext(schemes=["bcrypt"]).hash("password")
        except Exception:
            password_hash = "password"
        session.add(
            User(
                id="op1",
                email="operator@petc.local",
                password_hash=password_hash,
                full_name="Mock PETC Operator",
                role="operator",
                tesda_cert_no="TESDA-MOCK-001",
                certification_no="PETC-CERT-MOCK",
            )
        )
        session.commit()
