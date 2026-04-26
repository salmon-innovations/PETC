"""SQLAlchemy ORM models for the local SQLite database."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, default="operator")
    tesda_cert_no: Mapped[Optional[str]] = mapped_column(String)
    certification_no: Mapped[Optional[str]] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class VehicleCache(Base):
    __tablename__ = "vehicles_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plate_number: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    mv_no: Mapped[Optional[str]] = mapped_column(String)
    or_type: Mapped[Optional[str]] = mapped_column(String)
    cr_date: Mapped[Optional[str]] = mapped_column(String)
    cr_no: Mapped[Optional[str]] = mapped_column(String)
    district_office: Mapped[Optional[str]] = mapped_column(String)
    make: Mapped[Optional[str]] = mapped_column(String)
    series: Mapped[Optional[str]] = mapped_column(String)
    model: Mapped[Optional[str]] = mapped_column(String)
    vehicle_type: Mapped[Optional[str]] = mapped_column(String)
    year_model: Mapped[Optional[int]] = mapped_column(Integer)
    year: Mapped[Optional[int]] = mapped_column(Integer)
    color: Mapped[Optional[str]] = mapped_column(String)
    transmission: Mapped[Optional[str]] = mapped_column(String)
    fuel_type: Mapped[Optional[str]] = mapped_column(String)
    engine_no: Mapped[Optional[str]] = mapped_column(String)
    chassis_no: Mapped[Optional[str]] = mapped_column(String)
    owner_type: Mapped[Optional[str]] = mapped_column(String)
    last_name: Mapped[Optional[str]] = mapped_column(String)
    first_name: Mapped[Optional[str]] = mapped_column(String)
    middle_name: Mapped[Optional[str]] = mapped_column(String)
    organization: Mapped[Optional[str]] = mapped_column(String)
    address: Mapped[Optional[str]] = mapped_column(String)
    city: Mapped[Optional[str]] = mapped_column(String)
    owner_name: Mapped[Optional[str]] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, nullable=False, default="LTMS")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class DriverCache(Base):
    __tablename__ = "drivers_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    license_no: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String)
    license_type: Mapped[Optional[str]] = mapped_column(String)
    expiry_date: Mapped[Optional[str]] = mapped_column(String)   # ISO date string
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class EmissionTest(Base):
    __tablename__ = "emission_tests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    operator_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    plate_number: Mapped[str] = mapped_column(String, nullable=False, index=True)
    fuel_type: Mapped[str] = mapped_column(String, nullable=False)  # GAS | DIESEL
    pass_fail: Mapped[Optional[bool]] = mapped_column(Boolean)
    session_token: Mapped[str] = mapped_column(String, nullable=False)
    analyzer_serial: Mapped[Optional[str]] = mapped_column(String)
    raw_bytes_hex: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    tested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    synced_to_cloud: Mapped[bool] = mapped_column(Boolean, default=False)

    gas_result: Mapped[Optional["GasTestResult"]] = relationship(back_populates="test", uselist=False)
    diesel_result: Mapped[Optional["DieselTestResult"]] = relationship(back_populates="test", uselist=False)
    photos: Mapped[list["TestPhoto"]] = relationship(back_populates="test")
    ltms_submissions: Mapped[list["LtmsSubmission"]] = relationship(back_populates="test")


class GasTestResult(Base):
    __tablename__ = "gas_test_results"

    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("emission_tests.id"), primary_key=True)
    co_pct: Mapped[Optional[float]] = mapped_column(Float)
    hc_ppm: Mapped[Optional[float]] = mapped_column(Float)
    co2_pct: Mapped[Optional[float]] = mapped_column(Float)
    o2_pct: Mapped[Optional[float]] = mapped_column(Float)
    lambda_value: Mapped[Optional[float]] = mapped_column(Float)
    rpm: Mapped[Optional[int]] = mapped_column(Integer)
    oil_temp_c: Mapped[Optional[float]] = mapped_column(Float)

    test: Mapped["EmissionTest"] = relationship(back_populates="gas_result")


class DieselTestResult(Base):
    __tablename__ = "diesel_test_results"

    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("emission_tests.id"), primary_key=True)
    opacity_pct: Mapped[Optional[float]] = mapped_column(Float)
    k_value: Mapped[Optional[float]] = mapped_column(Float)
    rpm: Mapped[Optional[int]] = mapped_column(Integer)
    boost_kpa: Mapped[Optional[float]] = mapped_column(Float)

    test: Mapped["EmissionTest"] = relationship(back_populates="diesel_result")


class TestPhoto(Base):
    __tablename__ = "test_photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("emission_tests.id"), nullable=False)
    photo_type: Mapped[str] = mapped_column(String, nullable=False, default="OTHER")
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False, default="image/jpeg")
    camera_id: Mapped[Optional[str]] = mapped_column(String)
    s3_key: Mapped[Optional[str]] = mapped_column(String)   # set once mirrored
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    test: Mapped["EmissionTest"] = relationship(back_populates="photos")


class LtmsSubmission(Base):
    __tablename__ = "ltms_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("emission_tests.id"), nullable=False)
    payload_json: Mapped[Optional[str]] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String, nullable=False, default="PENDING")
    certificate_no: Mapped[Optional[str]] = mapped_column(String)
    ltms_reference_no: Mapped[Optional[str]] = mapped_column(String)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)

    test: Mapped["EmissionTest"] = relationship(back_populates="ltms_submissions")


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    test_id: Mapped[str] = mapped_column(String(36), ForeignKey("emission_tests.id"), nullable=False)
    copy_count: Mapped[int] = mapped_column(Integer, default=2)
    printed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GovOutbox(Base):
    __tablename__ = "gov_outbox"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    next_retry: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    response_json: Mapped[Optional[str]] = mapped_column(Text)


class CloudOutbox(Base):
    """Pending mirror pushes to the cloud backend."""
    __tablename__ = "cloud_outbox"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)  # "emission_test" | "ltms_submission" etc.
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    next_retry: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_error: Mapped[Optional[str]] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String)
    entity_id: Mapped[Optional[str]] = mapped_column(String)
    detail_json: Mapped[Optional[str]] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
