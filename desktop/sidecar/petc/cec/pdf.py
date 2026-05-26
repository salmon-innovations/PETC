"""Render a Certificate of Emission Compliance (CEC) to a PDF file.

Single-page A4 document modeled after the LTO Memorandum Circular VPT-2013-1766
requirements: LTO logo in the upper-right, plate/test-probe/technician photo
slots, CEC number, vehicle + owner + readings + verdict + technician block.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


BRAND = HexColor("#0b3d91")     # LTO-ish blue
BAND = HexColor("#0b3d91")
SOFT = HexColor("#e6efff")
LINE = HexColor("#cfd6e4")
MUTED = HexColor("#5a667a")


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
) -> Path:
    """Render the CEC PDF for an accepted LTMS submission. Returns the path."""
    vehicle = payload.get("vehicle") or {}
    owner = payload.get("owner") or {}
    technician = payload.get("technician") or {}
    verdict = payload.get("verdict") or {}
    readings = payload.get("readings") or {}
    photos = payload.get("photos") or []
    center_name = payload.get("centerName") or "PETC Center"

    path = cec_pdf_path(submission_id)
    c = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4

    _draw_header(c, width, height, certificate_no, issued_at, center_name)
    _draw_watermark(c, width, height, "PASS" if verdict.get("pass") else "FAIL")

    content_top = height - 42 * mm
    photo_bottom = _draw_photos(c, width, content_top, photos)

    data_top = photo_bottom - 6 * mm
    data_bottom = _draw_data_columns(c, width, data_top, vehicle, owner, readings, verdict)

    sig_top = data_bottom - 4 * mm
    _draw_technician_and_signature(c, width, sig_top, technician)

    _draw_footer(c, width, submission_id, issued_at)

    c.showPage()
    c.save()
    return path


# ---------------------------------------------------------------------------
# Layout sections
# ---------------------------------------------------------------------------
def _draw_header(c: canvas.Canvas, width: float, height: float,
                 certificate_no: str, issued_at: datetime, center_name: str) -> None:
    band_h = 22 * mm
    c.setFillColor(BAND)
    c.rect(0, height - band_h, width, band_h, stroke=0, fill=1)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, height - 11 * mm, "CERTIFICATE OF EMISSION COMPLIANCE")
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, height - 17 * mm, "Land Transportation Office  ·  Republic of the Philippines")

    # LTO logo slot — upper right per LTO MC VPT-2013-1766
    logo_w = 18 * mm
    logo_x = width - 20 * mm - logo_w
    logo_y = height - 20 * mm
    c.setStrokeColor(white)
    c.setLineWidth(0.6)
    c.rect(logo_x, logo_y, logo_w, logo_w, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(logo_x + logo_w / 2, logo_y + logo_w / 2 - 1, "LTO LOGO")

    # Certificate strip below the band
    strip_y = height - band_h - 9 * mm
    c.setFillColor(SOFT)
    c.rect(0, strip_y, width, 9 * mm, stroke=0, fill=1)
    c.setFillColor(BRAND)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, strip_y + 3 * mm, f"CEC No.  {certificate_no}")
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawRightString(width - 20 * mm, strip_y + 3 * mm,
                      f"{center_name}   ·   Issued {issued_at.strftime('%Y-%m-%d %H:%M')}")
    c.setFillColor(black)


def _draw_watermark(c: canvas.Canvas, width: float, height: float, label: str) -> None:
    c.saveState()
    c.setFont("Helvetica-Bold", 110)
    c.setFillColor(HexColor("#1ea64a") if label == "PASS" else HexColor("#c0392b"))
    c.setFillAlpha(0.08)
    c.translate(width / 2, height / 2)
    c.rotate(30)
    c.drawCentredString(0, -20, label)
    c.restoreState()


def _draw_photos(c: canvas.Canvas, width: float, top: float, photos: list[dict]) -> float:
    """Three photo slots: vehicle plate (FRONT/REAR), test probe, technician."""
    box_w = (width - 40 * mm - 8 * mm) / 3  # 3 boxes, 4mm gutters
    box_h = 42 * mm
    y = top - box_h

    slots = [
        ("Vehicle (plate visible)", _find_photo(photos, ("REAR", "FRONT"))),
        ("Test probe at tailpipe", _find_photo(photos, ("PROBE", "TAILPIPE"))),
        ("Technician", _find_photo(photos, ("TECHNICIAN",))),
    ]

    x = 20 * mm
    for label, photo_path in slots:
        _draw_photo_box(c, x, y, box_w, box_h, label, photo_path)
        x += box_w + 4 * mm

    return y


def _draw_photo_box(c: canvas.Canvas, x: float, y: float, w: float, h: float,
                    label: str, image_path: Optional[str]) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.rect(x, y, w, h, stroke=1, fill=0)

    img_area_h = h - 6 * mm
    if image_path and Path(image_path).is_file():
        try:
            c.drawImage(image_path, x + 1.5 * mm, y + 6 * mm + 0.5 * mm,
                        width=w - 3 * mm, height=img_area_h - 1.5 * mm,
                        preserveAspectRatio=True, anchor='c', mask='auto')
        except Exception:
            _draw_placeholder(c, x, y + 6 * mm, w, img_area_h, "image unavailable")
    else:
        _draw_placeholder(c, x, y + 6 * mm, w, img_area_h, "no photo")

    c.setFillColor(BRAND)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 2 * mm, y + 2 * mm, label)
    c.setFillColor(black)


def _draw_placeholder(c: canvas.Canvas, x: float, y: float, w: float, h: float, msg: str) -> None:
    c.setFillColor(HexColor("#f5f6f8"))
    c.rect(x + 1 * mm, y + 0.5 * mm, w - 2 * mm, h - 1 * mm, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 8)
    c.drawCentredString(x + w / 2, y + h / 2 - 2, msg)
    c.setFillColor(black)


def _draw_data_columns(c: canvas.Canvas, width: float, top: float,
                       vehicle: dict, owner: dict, readings: dict, verdict: dict) -> float:
    col_w = (width - 40 * mm - 6 * mm) / 2
    left_x = 20 * mm
    right_x = left_x + col_w + 6 * mm

    left_y = _section(c, left_x, top, col_w, "VEHICLE INFORMATION", [
        ("Plate No", vehicle.get("plateNo")),
        ("MV File No", vehicle.get("mvNo")),
        ("Engine No", vehicle.get("engineNo")),
        ("Chassis No", vehicle.get("chassisNo")),
        ("Make", vehicle.get("make")),
        ("Series / Model", vehicle.get("series")),
        ("Year Model", vehicle.get("yearModel")),
        ("Color", vehicle.get("color")),
        ("Vehicle Type", vehicle.get("vehicleType")),
        ("Fuel Type", vehicle.get("fuelType")),
        ("Transmission", vehicle.get("transmission")),
    ])

    right_y = _section(c, right_x, top, col_w, "REGISTERED OWNER", [
        ("Name", _owner_name(owner)),
        ("Address", owner.get("address")),
        ("City", owner.get("city")),
    ])

    # Readings block under owner column
    reading_rows = [(_pretty(k), _fmt_reading(v)) for k, v in readings.items()]
    right_y -= 4 * mm
    right_y = _section(c, right_x, right_y, col_w, "EMISSION READINGS",
                      reading_rows or [("(no readings)", "")])

    # Verdict box under readings
    right_y -= 4 * mm
    right_y = _verdict_box(c, right_x, right_y, col_w, verdict)

    return min(left_y, right_y)


def _section(c: canvas.Canvas, x: float, y: float, w: float, title: str,
             rows: list[tuple[str, Optional[object]]]) -> float:
    # Section title bar
    c.setFillColor(BRAND)
    c.rect(x, y - 5 * mm, w, 5 * mm, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x + 2 * mm, y - 3.6 * mm, title)
    c.setFillColor(black)

    y -= 5 * mm
    row_h = 5.2 * mm
    label_w = 32 * mm
    c.setFont("Helvetica", 9)
    for i, (label, value) in enumerate(rows):
        row_y = y - (i + 1) * row_h
        if i % 2 == 1:
            c.setFillColor(HexColor("#f8f9fb"))
            c.rect(x, row_y, w, row_h, stroke=0, fill=1)
            c.setFillColor(black)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8.5)
        c.drawString(x + 2 * mm, row_y + 1.6 * mm, label.upper())
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x + 2 * mm + label_w, row_y + 1.6 * mm, _safe(value))

    # Outer border
    body_h = row_h * len(rows)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.rect(x, y - body_h, w, body_h + 5 * mm, stroke=1, fill=0)

    return y - body_h


def _verdict_box(c: canvas.Canvas, x: float, y: float, w: float, verdict: dict) -> float:
    h = 14 * mm
    is_pass = bool(verdict.get("pass"))
    fill = HexColor("#e8f7ed") if is_pass else HexColor("#fdecea")
    border = HexColor("#1ea64a") if is_pass else HexColor("#c0392b")

    c.setFillColor(fill)
    c.setStrokeColor(border)
    c.setLineWidth(1)
    c.rect(x, y - h, w, h, stroke=1, fill=1)

    c.setFillColor(border)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(x + 3 * mm, y - 7 * mm, "PASS" if is_pass else "FAIL")
    c.setFont("Helvetica", 8.5)
    c.setFillColor(black)
    notes = "; ".join(verdict.get("reasons") or []) or "Within configured emission limits"
    c.drawString(x + 22 * mm, y - 7 * mm, notes[:80])

    return y - h


def _draw_technician_and_signature(c: canvas.Canvas, width: float, top: float, technician: dict) -> None:
    x = 20 * mm
    w = width - 40 * mm
    h = 26 * mm
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.rect(x, top - h, w, h, stroke=1, fill=0)

    c.setFillColor(BRAND)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x + 2 * mm, top - 4 * mm, "TECHNICIAN  /  CERTIFICATION")
    c.setFillColor(black)

    # Three columns of technician data
    col_w = w / 3
    fields = [
        ("Technician Name", technician.get("technicianName")),
        ("TESDA Cert. No", technician.get("tesdaCertNo")),
        ("Certification No", technician.get("certificationNo")),
    ]
    for i, (label, value) in enumerate(fields):
        cx = x + i * col_w + 2 * mm
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.5)
        c.drawString(cx, top - 9 * mm, label.upper())
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(cx, top - 13 * mm, _safe(value))

    # Signature line
    sig_y = top - h + 6 * mm
    c.setStrokeColor(black)
    c.setLineWidth(0.4)
    c.line(x + 2 * mm, sig_y, x + 80 * mm, sig_y)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(x + 2 * mm, sig_y - 3.5 * mm, "SIGNATURE OVER PRINTED NAME OF TECHNICIAN")
    c.setFillColor(black)


def _draw_footer(c: canvas.Canvas, width: float, submission_id: str, issued_at: datetime) -> None:
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawString(20 * mm, 10 * mm,
                 f"Submission {submission_id}  ·  Generated by PETC  ·  {issued_at.isoformat()}")
    c.drawRightString(width - 20 * mm, 10 * mm,
                      "This document is system-generated. Verify against LTMS records.")
    c.setFillColor(black)


# ---------------------------------------------------------------------------
# Helpers
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


def _owner_name(owner: dict) -> str:
    if owner.get("ownerType") == "ORGANIZATION":
        return owner.get("organization") or ""
    return " ".join(
        part for part in [owner.get("firstName"), owner.get("middleName"), owner.get("lastName")]
        if part
    )


def _pretty(key: str) -> str:
    return key.replace("_", " ").upper()


def _fmt_reading(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)
