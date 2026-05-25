"""
Shared frame parser for Foshan Analytical / "FOFEN" RS232 protocols.

Observed frame layout (PETROL gas analyzer and FTY-100 opacimeter both push the
same envelope; only the payload semantics differ):

    62 24                                ← FRAME START (b$)
    e7 e7 e7 e7 e7 e7 e7 e7              ← idle/header padding
    63 24 63 24                          ← record-separator x2 (block start)
    XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX XX  ← 16-byte header
    63 24 <8-byte row>                   ← row 1
    63 24 <8-byte row>                   ← row 2
    ...
    63 24 <8-byte row>                   ← row 9 (9 rows total observed)
    63 24 e7 e7 e7 e7 e7 e7 e7 e7        ← trailing idle padding
    63 f3                                ← FRAME END (c·)

Total frame length ≈ 129 bytes.

Encoding within payload bytes: every data byte has bit 7 set (0x80 mask) to
keep it distinct from the 0x62/0x63 framing markers. Strip the high bit to get
the underlying value. The remaining 7 bits encode digits / decimal-point / sign
flags in a way that's still being reverse-engineered — see FofenGasAnalyzer for
the working hypothesis.
"""
from __future__ import annotations

from dataclasses import dataclass

_FRAME_START = b"\x62\x24"  # b$
_FRAME_END = b"\x63\xf3"    # c·
_ROW_SEP = b"\x63\x24"      # c$
_ROW_LEN = 8


@dataclass(frozen=True)
class FofenFrame:
    header: bytes          # 16 bytes between the double 63 24 and the first row
    rows: list[bytes]      # each row is 8 bytes; high bit not yet stripped
    raw: bytes             # full original frame including markers


def find_frame(buf: bytes) -> FofenFrame | None:
    """Return the first complete frame in ``buf``, or None if none yet.

    Caller is responsible for trimming consumed bytes from its own buffer."""
    start = buf.find(_FRAME_START)
    if start < 0:
        return None
    end = buf.find(_FRAME_END, start + len(_FRAME_START))
    if end < 0:
        return None
    raw = buf[start : end + len(_FRAME_END)]
    return _parse(raw)


def _parse(raw: bytes) -> FofenFrame | None:
    # Skip start marker and any leading 0xe7 padding
    body = raw[len(_FRAME_START) : -len(_FRAME_END)]
    body = body.lstrip(b"\xe7")

    # Drop the double row-sep that marks block start
    if body.startswith(_ROW_SEP * 2):
        body = body[len(_ROW_SEP) * 2 :]
    elif body.startswith(_ROW_SEP):
        body = body[len(_ROW_SEP) :]

    # First chunk before the next 63 24 is the 16-byte header
    next_sep = body.find(_ROW_SEP)
    if next_sep < 0:
        return None
    header = body[:next_sep]
    rest = body[next_sep:]

    rows: list[bytes] = []
    while rest.startswith(_ROW_SEP):
        rest = rest[len(_ROW_SEP) :]
        if len(rest) < _ROW_LEN:
            break
        row = rest[:_ROW_LEN]
        # Skip trailing idle-padding rows (all 0xe7)
        if row == b"\xe7" * _ROW_LEN:
            break
        rows.append(row)
        rest = rest[_ROW_LEN:]

    return FofenFrame(header=header, rows=rows, raw=raw)


def strip_high_bit(row: bytes) -> bytes:
    """Return ``row`` with bit 7 cleared on every byte."""
    return bytes(b & 0x7F for b in row)
