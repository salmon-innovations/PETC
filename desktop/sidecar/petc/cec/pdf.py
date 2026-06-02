"""Render a Certificate of Emission Compliance (CEC) to a PDF file.

The page is one A4 portrait sheet divided into two halves so the operator
prints once and tears the sheet in two: the top half is the customer copy,
the bottom half is the center copy.  Layout follows the existing-IT-provider
sample (MEGA EMISSION TESTING CENTER / THE NEW CYBERLINKTECH, INC.) — plain
center header (no LTO branding band), OR No + DERMALOG token + IT provider
attribution + classification + validity window + "FOR REGISTRATION ONLY"
disclaimer, "PASSED" / "FAILED" as plain text in the corner.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from reportlab.lib.colors import HexColor, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


LINE = HexColor("#9a9a9a")
MUTED = HexColor("#5a667a")
PASS_GREEN = HexColor("#1ea64a")
FAIL_RED = HexColor("#c0392b")

IT_PROVIDER = "DIGIFLASH  ·  SALMON INNOVATIONS"


def cec_pdf_dir() -> Path:
    base = Path(os.environ.get("PETC_DATA_DIR", "."))
    out = base / "cec"
    out.mkdir(parents=True, exist_ok=True)
    return out


def cec_pdf_path(submission_id: str) -> Path:
    return cec_pdf_dir() / f"{submission_id}.pdf"


def render_cec_pdf(
    *,
    submission_id: str,
    certificate_no: str,
    payload: dict,
    issued_at: datetime,
    or_no: Optional[str] = None,
    dermalog_token: Optional[str] = None,
    valid_from: Optional[str] = None,
    valid_until: Optional[str] = None,
) -> Path:
    """Render the CEC PDF for an accepted LTMS submission. Returns the path."""
    path = cec_pdf_path(submission_id)
    c = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4

    # Derive validity window from issued_at if LTMS did not supply one.
    issued_date = issued_at.date()
    vf = valid_from or issued_date.isoformat()
    vu = valid_until or (issued_date + timedelta(days=60)).isoformat()

    # Top half: customer copy (full layout)
    _draw_full_copy(
        c, width,
        copy_label="CUSTOMER COPY",
        top=height - 8 * mm,
        bottom=height / 2 + 4 * mm,
        certificate_no=certificate_no,
        or_no=or_no,
        dermalog_token=dermalog_token,
        valid_from=vf,
        valid_until=vu,
        payload=payload,
        issued_at=issued_at,
    )

    # Centre tear-line
    c.setDash(2, 2)
    c.setStrokeColor(LINE)
    c.line(10 * mm, height / 2, width - 10 * mm, height / 2)
    c.setDash()

    # Bottom half: center copy (condensed)
    _draw_condensed_copy(
        c, width,
        copy_label="CENTER COPY",
        top=height / 2 - 4 * mm,
        bottom=8 * mm,
        certificate_no=certificate_no,
        or_no=or_no,
        dermalog_token=dermalog_token,
        valid_from=vf,
        valid_until=vu,
        payload=payload,
        issued_at=issued_at,
    )

    c.showPage()
    c.save()
    return path


# ---------------------------------------------------------------------------
# Full (customer) copy — top half
# ---------------------------------------------------------------------------
def _draw_full_copy(
    c: canvas.Canvas,
    width: float,
    *,
    copy_label: str,
    top: float,
    bottom: float,
    certificate_no: str,
    or_no: Optional[str],
    dermalog_token: Optional[str],
    valid_from: str,
    valid_until: str,
    payload: dict,
    issued_at: datetime,
) -> None:
    vehicle = payload.get("vehicle") or {}
    owner = payload.get("owner") or {}
    technician = payload.get("technician") or {}
    verdict = payload.get("verdict") or {}
    readings = payload.get("readings") or {}
    photos = payload.get("photos") or []
    center_name = payload.get("centerName") or "PETC CENTER"
    center_address = payload.get("centerAddress") or ""
    center_accred = payload.get("centerAccreditationNo") or ""

    # Header (plain center text — matches sample)
    y = top
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(width / 2, y, center_name.upper())
    y -= 4.5 * mm
    if center_address:
        c.setFont("Helvetica", 8)
        c.drawCentredString(width / 2, y, center_address.upper())
        y -= 4 * mm
    if center_accred:
        c.setFont("Helvetica", 7.5)
        c.setFillColor(MUTED)
        c.drawCentredString(width / 2, y, f"Accreditation No.: {center_accred}")
        c.setFillColor(black)
        y -= 4 * mm
    # Issue date (top-left, short form like sample)
    c.setFont("Helvetica", 8)
    c.drawCentredString(width / 2, y, issued_at.strftime("%m/%d/%Y"))
    y -= 5 * mm

    # OR No (top-right corner of header zone)
    if or_no:
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(width - 15 * mm, top, or_no)
        c.setFont("Helvetica", 8)
        # Short form: last 4–5 digits as receipt no
        short = or_no[-4:]
        c.drawRightString(width - 15 * mm, top - 4 * mm, f"OR No.: {short}")

    # Copy label (top-left)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(MUTED)
    c.drawString(15 * mm, top, copy_label)
    c.setFillColor(black)

    # ── Owner block (left) + Vehicle classification (right) ────────────
    c.setFont("Helvetica-Bold", 9)
    c.drawString(15 * mm, y, _owner_name(owner))
    y -= 3.5 * mm
    c.setFont("Helvetica", 8)
    c.drawString(15 * mm, y, (owner.get("address") or "") + " " + (owner.get("city") or ""))
    y -= 6 * mm

    # ── Two-column data block (matches sample's left / right split) ────
    left_x = 15 * mm
    right_x = width / 2 + 5 * mm
    block_top = y
    c.setFont("Helvetica", 8.5)

    left_rows = [
        ("Plate No", vehicle.get("plateNo")),
        ("MV File No", vehicle.get("mvNo")),
        ("Engine No", vehicle.get("engineNo")),
        ("Chassis No", vehicle.get("chassisNo")),
        ("Test Datetime", issued_at.strftime("%m/%d/%Y %I:%M:%S %p")),
    ]
    right_rows = [
        ("Fuel Type", vehicle.get("fuelType")),
        ("Year Model", vehicle.get("yearModel")),
        ("Make / Series", _join(vehicle.get("make"), vehicle.get("series"))),
        ("Vehicle Type", vehicle.get("vehicleType")),
        ("Color", vehicle.get("color")),
        ("Classification", vehicle.get("classification") or "—"),
    ]

    rowy = block_top
    for label, value in left_rows:
        c.setFillColor(MUTED)
        c.drawString(left_x, rowy, label.upper())
        c.setFillColor(black)
        c.drawString(left_x + 28 * mm, rowy, _safe(value))
        rowy -= 4 * mm

    rowy = block_top
    for label, value in right_rows:
        c.setFillColor(MUTED)
        c.drawString(right_x, rowy, label.upper())
        c.setFillColor(black)
        c.drawString(right_x + 28 * mm, rowy, _safe(value))
        rowy -= 4 * mm

    y = min(block_top - len(left_rows) * 4 * mm, block_top - len(right_rows) * 4 * mm) - 2 * mm

    # Validity window
    c.setFont("Helvetica", 8)
    c.drawString(left_x, y, _fmt_date_long(valid_from))
    c.drawString(right_x, y, _fmt_date_long(valid_until))
    y -= 5 * mm

    # ── Photos row (two slots side-by-side, like the sample) ──────────
    photo_top = y
    photo_h = 32 * mm
    photo_w = 42 * mm
    gap = 4 * mm
    photo_y = photo_top - photo_h

    plate_photo = _find_photo(photos, ("REAR", "FRONT"))
    close_photo = _find_photo(photos, ("PLATE", "CLOSE", "RESULT")) or plate_photo

    _draw_photo_box(c, left_x, photo_y, photo_w, photo_h, plate_photo, issued_at)
    _draw_photo_box(c, left_x + photo_w + gap, photo_y, photo_w, photo_h, close_photo, issued_at)

    # Technician name under first photo, license # under second
    c.setFont("Helvetica-Bold", 8)
    c.drawString(left_x, photo_y - 3.5 * mm, (technician.get("technicianName") or "").upper())
    c.drawString(left_x + photo_w + gap, photo_y - 3.5 * mm, (technician.get("technicianName") or "").upper())
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(left_x + photo_w + gap, photo_y - 7 * mm, _safe(technician.get("certificationNo")))
    c.setFillColor(black)

    # Reading numbers + PASSED on the right
    readings_x = left_x + 2 * (photo_w + gap) + 4 * mm
    rx = readings_x
    ry = photo_top - 4 * mm
    c.setFont("Helvetica", 10)
    for r in _formatted_readings(readings, vehicle.get("fuelType")):
        c.drawString(rx, ry, r)
        ry -= 5 * mm

    # PASSED / FAILED text (plain, like sample)
    is_pass = bool(verdict.get("pass"))
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(PASS_GREEN if is_pass else FAIL_RED)
    c.drawString(rx, photo_y + 2 * mm, "PASSED" if is_pass else "FAILED")
    c.setFillColor(black)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(rx, photo_y - 3.5 * mm, "FOR REGISTRATION ONLY")
    c.setFillColor(black)

    # DERMALOG token + IT provider attribution at the bottom of the half
    foot_y = bottom + 2 * mm
    if dermalog_token:
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MUTED)
        c.drawString(15 * mm, foot_y + 4 * mm, f"DERMALOG: {dermalog_token}")
        c.setFillColor(black)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(15 * mm, foot_y, IT_PROVIDER)
    c.drawRightString(width - 15 * mm, foot_y, f"CEC No. {certificate_no}")
    c.setFillColor(black)


# ---------------------------------------------------------------------------
# Condensed (center) copy — bottom half
# ---------------------------------------------------------------------------
def _draw_condensed_copy(
    c: canvas.Canvas,
    width: float,
    *,
    copy_label: str,
    top: float,
    bottom: float,
    certificate_no: str,
    or_no: Optional[str],
    dermalog_token: Optional[str],
    valid_from: str,
    valid_until: str,
    payload: dict,
    issued_at: datetime,
) -> None:
    vehicle = payload.get("vehicle") or {}
    owner = payload.get("owner") or {}
    technician = payload.get("technician") or {}
    verdict = payload.get("verdict") or {}
    readings = payload.get("readings") or {}
    photos = payload.get("photos") or []

    left_x = 15 * mm

    # Copy label
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(MUTED)
    c.drawString(left_x, top, copy_label)
    c.setFillColor(black)

    # DERMALOG header line
    if dermalog_token:
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MUTED)
        c.drawString(width / 2 - 30 * mm, top, f"DERMALOG: {dermalog_token}")
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(width / 2 - 30 * mm, top - 3.5 * mm, IT_PROVIDER)

    y = top - 8 * mm

    # Small photo on the left
    plate_photo = _find_photo(photos, ("REAR", "FRONT"))
    photo_w = 30 * mm
    photo_h = 24 * mm
    photo_y = y - photo_h
    _draw_photo_box(c, left_x, photo_y, photo_w, photo_h, plate_photo, issued_at)

    # Technician name + cert # under photo
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(left_x, photo_y - 3.5 * mm, (technician.get("technicianName") or "").upper())
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(left_x, photo_y - 6.5 * mm, _safe(technician.get("certificationNo")))
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(PASS_GREEN if verdict.get("pass") else FAIL_RED)
    c.drawString(left_x, photo_y - 11 * mm, "PASSED" if verdict.get("pass") else "FAILED")
    c.setFillColor(black)

    # Compact data block to the right of the photo
    data_x = left_x + photo_w + 6 * mm
    dy = y
    c.setFont("Helvetica", 7.5)
    compact_rows = [
        (_owner_name(owner), ""),
        ((owner.get("address") or "") + " " + (owner.get("city") or ""), ""),
        (vehicle.get("plateNo"), str(vehicle.get("yearModel") or "")),
        (vehicle.get("mvNo"), _join(vehicle.get("make"), vehicle.get("series"))),
        (vehicle.get("engineNo"), vehicle.get("color")),
        (vehicle.get("chassisNo"), vehicle.get("classification") or "—"),
        (issued_at.strftime("%m/%d/%Y %I:%M:%S %p"), "FOR REGISTRATION ONLY"),
        (_fmt_date_long(valid_from), _fmt_date_long(valid_until)),
    ]
    for left, right in compact_rows:
        c.drawString(data_x, dy, _safe(left))
        if right:
            c.drawRightString(width - 15 * mm, dy, _safe(right))
        dy -= 3.8 * mm

    # Readings under the photo
    ready = photo_y - 16 * mm
    c.setFont("Helvetica", 8)
    for r in _formatted_readings(readings, vehicle.get("fuelType")):
        c.drawString(left_x + 2 * mm, ready, r)
        c.drawString(left_x + 35 * mm, ready, "")
        ready -= 4 * mm

    # Footer (OR No + CEC No)
    foot_y = bottom + 2 * mm
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(15 * mm, foot_y, f"OR No.: {or_no or '—'}")
    c.drawRightString(width - 15 * mm, foot_y, f"CEC No. {certificate_no}")
    c.setFillColor(black)


# ---------------------------------------------------------------------------
# Shared drawing helpers
# ---------------------------------------------------------------------------
def _draw_photo_box(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    image_path: Optional[str],
    issued_at: datetime,
) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.rect(x, y, w, h, stroke=1, fill=0)

    if image_path and Path(image_path).is_file():
        try:
            c.drawImage(
                image_path,
                x + 0.8 * mm, y + 0.8 * mm,
                width=w - 1.6 * mm, height=h - 1.6 * mm,
                preserveAspectRatio=True, anchor="c", mask="auto",
            )
        except Exception:
            _draw_placeholder(c, x, y, w, h, "image unavailable")
    else:
        _draw_placeholder(c, x, y, w, h, "no photo")

    # Camera timestamp burn-in (mimics sample's "06/02/2026 10:42:49 AM" overlay)
    c.setFont("Helvetica", 5.5)
    c.setFillColor(HexColor("#ffffffcc"))
    c.rect(x + 0.8 * mm, y + h - 3 * mm, 24 * mm, 2.5 * mm, stroke=0, fill=1)
    c.setFillColor(black)
    c.drawString(x + 1.2 * mm, y + h - 2.4 * mm, issued_at.strftime("%m/%d/%Y %I:%M:%S %p"))


def _draw_placeholder(
    c: canvas.Canvas, x: float, y: float, w: float, h: float, msg: str
) -> None:
    c.setFillColor(HexColor("#f5f6f8"))
    c.rect(x + 0.5 * mm, y + 0.5 * mm, w - 1 * mm, h - 1 * mm, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 7)
    c.drawCentredString(x + w / 2, y + h / 2, msg)
    c.setFillColor(black)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------
def _find_photo(photos: list[dict], preferred_types: tuple[str, ...]) -> Optional[str]:
    by_type = {(p.get("photoType") or "").upper(): p.get("filePath") for p in photos}
    for t in preferred_types:
        if by_type.get(t):
            return by_type[t]
    return None


def _safe(value) -> str:
    if value is None or value == "":
        return "—"
    return str(value)


def _join(*parts) -> str:
    return " - ".join(str(p) for p in parts if p)


def _owner_name(owner: dict) -> str:
    if owner.get("ownerType") == "ORGANIZATION":
        return owner.get("organization") or ""
    parts = [owner.get("lastName"), owner.get("firstName"), owner.get("middleName")]
    name = ", ".join([p for p in [owner.get("lastName")] if p])
    rest = " ".join(p for p in [owner.get("firstName"), owner.get("middleName")] if p)
    if name and rest:
        return f"{name.upper()}, {rest.upper()}"
    return " ".join(p.upper() for p in parts if p)


def _formatted_readings(readings: dict, fuel_type: Optional[str]) -> list[str]:
    """Render the small numeric readout shown in the sample (e.g. `0.04  86  0`)."""
    if not readings:
        return []
    if (fuel_type or "").upper() == "DIESEL":
        return [_fmt_num(readings.get("opacity_pct")), _fmt_num(readings.get("k_value"))]
    return [
        _fmt_num(readings.get("co_pct")),
        _fmt_num(readings.get("hc_ppm")),
        _fmt_num(readings.get("co2_pct") or readings.get("o2_pct")),
    ]


def _fmt_num(value) -> str:
    if value is None:
        return "0"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def _fmt_date_long(iso: str) -> str:
    """`2026-06-02` → `Tuesday, Jun 2 2026` (matches sample)."""
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        return d.strftime("%A, %b %-d %Y")
    except Exception:
        return iso
