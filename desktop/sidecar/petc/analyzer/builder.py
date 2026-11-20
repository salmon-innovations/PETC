"""
Build an analyzer instance from the app_settings table.

The UI stores analyzer.type as either a machine brand/family (preferred) or a
legacy concrete adapter key.  Run Test supplies the fuel type, and the sidecar
resolves the concrete adapter needed for that fuel at test start.
"""
from __future__ import annotations

import logging

from .base import Analyzer, FuelType

logger = logging.getLogger(__name__)

BRAND_TYPES = {"mock", "cartesykj", "koeng", "fofen", "generic_serial"}
CONCRETE_TYPES = {
    "serial_gas",
    "serial_diesel",
    "fty_opacimeter",
    "fofen_gas",
    "fofen_ascii",
    "koeng_gas",
    "koeng_diesel",
    "cartesykj_gas",
    "cartesykj_diesel",
    "cartesykj_desiel",
}
ANALYZER_TYPES = BRAND_TYPES | CONCRETE_TYPES

_BRAND_BY_CONCRETE = {
    "serial_gas": "generic_serial",
    "serial_diesel": "generic_serial",
    "fty_opacimeter": "fofen",
    "fofen_gas": "fofen",
    "fofen_ascii": "fofen",
    "koeng_gas": "koeng",
    "koeng_diesel": "koeng",
    "cartesykj_gas": "cartesykj",
    "cartesykj_diesel": "cartesykj",
    "cartesykj_desiel": "cartesykj",
}

_RESOLVED_BY_BRAND = {
    "mock": {FuelType.GAS: "mock", FuelType.DIESEL: "mock"},
    "cartesykj": {FuelType.GAS: "cartesykj_gas", FuelType.DIESEL: "cartesykj_diesel"},
    "koeng": {FuelType.GAS: "koeng_gas", FuelType.DIESEL: "koeng_diesel"},
    "fofen": {FuelType.GAS: "fofen_gas", FuelType.DIESEL: "fty_opacimeter"},
    "generic_serial": {FuelType.GAS: "serial_gas", FuelType.DIESEL: "serial_diesel"},
}


def _read_settings() -> dict[str, str]:
    from ..db.models import AppSetting
    from ..db.session import SessionLocal

    with SessionLocal() as session:
        rows = session.query(AppSetting).filter(AppSetting.key.like("analyzer.%")).all()
        return {r.key: (r.value or "") for r in rows}


def _parse_address(raw: str) -> int:
    try:
        return int(raw, 16)
    except (TypeError, ValueError):
        return 0x01


def normalize_analyzer_brand(kind: str) -> str:
    kind = (kind or "mock").strip()
    return _BRAND_BY_CONCRETE.get(kind, kind)


def resolve_analyzer_type(saved_type_or_brand: str, fuel_type: FuelType | str) -> str:
    try:
        fuel = fuel_type if isinstance(fuel_type, FuelType) else FuelType(str(fuel_type).upper())
    except ValueError as exc:
        raise ValueError("fuel_type must be GAS or DIESEL") from exc

    kind = (saved_type_or_brand or "mock").strip()
    if kind in _RESOLVED_BY_BRAND:
        return _RESOLVED_BY_BRAND[kind][fuel]
    if kind in CONCRETE_TYPES:
        return kind
    raise ValueError(f"unsupported analyzer type or brand: {kind}")


def concrete_label(kind: str) -> str:
    labels = {
        "mock": "Mock Analyzer",
        "serial_gas": "Generic Gas Analyzer - ASCII",
        "serial_diesel": "Generic Diesel Analyzer - Binary",
        "fty_opacimeter": "FTY-100 Diesel Opacimeter",
        "fofen_gas": "Fofen Petrol Gas Analyzer",
        "fofen_ascii": "Fofen Petrol Gas Analyzer - ASCII Receipt",
        "koeng_gas": "KOENG Gas Analyzer",
        "koeng_diesel": "KOENG Diesel Opacimeter",
        "cartesykj_gas": "CARTESYKJ MQ-550 Gas Analyzer",
        "cartesykj_diesel": "CARTESYKJ MQY-200 Diesel Opacimeter",
        "cartesykj_desiel": "CARTESYKJ MQY-200 Diesel Opacimeter",
    }
    return labels.get(kind, kind)



def infer_analyzer_type(analyzer: Analyzer | None) -> str | None:
    if analyzer is None:
        return None

    tagged = getattr(analyzer, "_petc_analyzer_type", None)
    if tagged:
        return tagged

    class_name = analyzer.__class__.__name__
    return {
        "MockAnalyzer": "mock",
        "AsciiGasAnalyzer": "serial_gas",
        "BinaryDieselAnalyzer": "serial_diesel",
        "FtyOpacimeterAnalyzer": "fty_opacimeter",
        "FofenGasAnalyzer": "fofen_gas",
        "FofenAsciiReceiptAnalyzer": "fofen_ascii",
        "KoengGasAnalyzer": "koeng_gas",
        "KoengDieselAnalyzer": "koeng_diesel",
        "CartesykjGasAnalyzer": "cartesykj_gas",
        "CartesykjDieselAnalyzer": "cartesykj_diesel",
    }.get(class_name)

def _tag(analyzer: Analyzer, kind: str) -> Analyzer:
    setattr(analyzer, "_petc_analyzer_type", kind)
    return analyzer


def build_analyzer_from_settings(concrete_type: str | None = None) -> Analyzer:
    settings = _read_settings()
    saved_kind = settings.get("analyzer.type", "mock")
    kind = concrete_type or resolve_analyzer_type(saved_kind, FuelType.GAS)

    if kind == "mock":
        from .mock import MockAnalyzer
        return _tag(MockAnalyzer(), kind)

    common = {
        "port": settings.get("analyzer.port", "COM1"),
        "baud_rate": int(settings.get("analyzer.baud", "9600")),
        "data_bits": int(settings.get("analyzer.data_bits", "8")),
        "parity": settings.get("analyzer.parity", "N"),
        "stop_bits": int(settings.get("analyzer.stop_bits", "1")),
        "address": _parse_address(settings.get("analyzer.address", "01")),
    }

    if kind == "serial_gas":
        from .ascii_gas import AsciiGasAnalyzer
        return _tag(AsciiGasAnalyzer(**common), kind)
    if kind == "serial_diesel":
        from .binary_diesel import BinaryDieselAnalyzer
        return _tag(BinaryDieselAnalyzer(**common), kind)
    if kind == "fty_opacimeter":
        from .fty_opacimeter import FtyOpacimeterAnalyzer
        return _tag(FtyOpacimeterAnalyzer(**common), kind)
    if kind == "fofen_gas":
        from .fofen_gas import FofenGasAnalyzer
        return _tag(FofenGasAnalyzer(**common), kind)
    if kind == "fofen_ascii":
        from .fofen_ascii import FofenAsciiReceiptAnalyzer
        return _tag(FofenAsciiReceiptAnalyzer(**common), kind)
    if kind == "koeng_gas":
        from .koeng_gas import KoengGasAnalyzer
        return _tag(KoengGasAnalyzer(
            port=common["port"],
            serial_no=settings.get("analyzer.serial_no", ""),
        ), kind)
    if kind == "koeng_diesel":
        from .koeng_diesel import KoengDieselAnalyzer
        return _tag(KoengDieselAnalyzer(
            port=common["port"],
            serial_no=settings.get("analyzer.serial_no", ""),
        ), kind)
    if kind in ("cartesykj_diesel", "cartesykj_desiel"):
        from .cartesykj_desiel import CartesykjDieselAnalyzer
        return _tag(CartesykjDieselAnalyzer(
            port=common["port"],
            serial_no=settings.get("analyzer.serial_no", ""),
        ), "cartesykj_diesel")
    if kind == "cartesykj_gas":
        from .cartesykj_gas import CartesykjGasAnalyzer
        return _tag(CartesykjGasAnalyzer(
            port=common["port"],
            serial_no=settings.get("analyzer.serial_no", ""),
        ), kind)

    logger.warning("Unknown analyzer.type=%r - falling back to MockAnalyzer", kind)
    from .mock import MockAnalyzer
    return _tag(MockAnalyzer(), "mock")
