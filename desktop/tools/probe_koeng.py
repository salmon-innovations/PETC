r"""Probe a KOENG gas analyzer using its vendor application's status command.

The installed Koeng Analyzer System v1.0 configures the gas port as 9600 8N1
and polls with ``ESC ST CR LF``. This utility reproduces that read-only status
poll, records exact traffic, and decodes measurement frames without issuing
mode-changing commands such as ZERO, PURGE, STANDBY, or MEASURE.
"""
from __future__ import annotations

import argparse
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import serial

STATUS_REQUEST = b"\x1bST\r\n"
CURRENT_ANALYSIS_REQUEST = b"\x1bCA\r\n"
MEASURE_REQUEST = b"\x1b\x1bK5\r\n"
STANDBY_REQUEST = b"\x1b\x1bK2\r\n"

STATUS_NAMES = {
    "010": "ready",
    "020": "zeroing",
    "030": "measuring",
    "035": "measuring",
    "040": "purge-time",
    "041": "purging",
    "042": "purging-cell",
    "050": "selection",
    "130": "selection",
    "200": "warming-up",
}


def _number(field: bytes) -> int:
    return int(field.decode("ascii"))


def parse_frame(frame: bytes) -> dict | None:
    """Decode one CR-terminated KOENG frame, including its trailing CR."""
    if not frame.endswith(b"\r") or not frame.startswith(b"\x1b"):
        return None

    if frame.startswith(b"\x1bS") and len(frame) >= 6:
        code = frame[2:5].decode("ascii", errors="replace")
        return {"kind": "status", "code": code, "state": STATUS_NAMES.get(code, "unknown")}

    if not frame.startswith(b"\x1bC") or len(frame) not in (27, 28):
        return None

    try:
        if len(frame) == 27:
            co_raw = frame[2:6]
            hc_raw = frame[6:10]
            co2_raw = frame[10:14]
            o2_raw = frame[14:18]
            lambda_raw = frame[18:22]
            final_raw = frame[22:26]
        else:
            co_raw = frame[2:6]
            hc_raw = frame[6:11]
            co2_raw = frame[11:15]
            o2_raw = frame[15:19]
            lambda_raw = frame[19:23]
            final_raw = frame[23:27]

        reading: dict[str, object] = {
            "kind": "measurement",
            "co_pct": _number(co_raw) / 100.0,
            "hc_ppm": _number(hc_raw),
            "co2_pct": _number(co2_raw) / 10.0,
            "o2_pct": _number(o2_raw) / 100.0,
            "lambda": _number(lambda_raw) / 1000.0,
        }
        if final_raw.startswith(b"A"):
            reading["afr"] = _number(final_raw[1:]) / 10.0
        else:
            reading["nox_ppm"] = _number(final_raw)
        return reading
    except (UnicodeDecodeError, ValueError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="KOENG serial port, for example COM3")
    parser.add_argument("--duration", type=float, default=15.0)
    parser.add_argument("--interval", type=float, default=1.1)
    parser.add_argument(
        "--measure",
        action="store_true",
        help="Enter MEASURE mode, request live values, then restore STANDBY on exit",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "petc-serial-captures",
    )
    args = parser.parse_args()
    if args.duration <= 0 or args.interval <= 0:
        parser.error("duration and interval must be positive")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    stem = f"{started.strftime('%Y%m%dT%H%M%S.%fZ')}_{args.port}_koeng_probe"
    log_path = args.output_dir / f"{stem}.log"
    bin_path = args.output_dir / f"{stem}.bin"

    connection = serial.Serial(
        port=args.port,
        baudrate=9600,
        bytesize=serial.EIGHTBITS,
        parity=serial.PARITY_NONE,
        stopbits=serial.STOPBITS_ONE,
        timeout=0.1,
    )
    rx_buffer = bytearray()
    received = bytearray()
    decoded: list[dict] = []
    deadline = time.monotonic() + args.duration
    next_poll = time.monotonic()
    request_current = False

    try:
        with log_path.open("w", encoding="utf-8") as log_file:
            log_file.write(json.dumps({
                "port": args.port,
                "baud": 9600,
                "format": "8N1",
                "request_hex": STATUS_REQUEST.hex(" "),
                "started_utc": started.isoformat(),
            }) + "\n")
            if args.measure:
                connection.write(MEASURE_REQUEST)
                connection.flush()
                log_file.write(f"TX measure {MEASURE_REQUEST.hex(' ')}\n")
            while time.monotonic() < deadline:
                now = time.monotonic()
                if now >= next_poll:
                    request = CURRENT_ANALYSIS_REQUEST if request_current else STATUS_REQUEST
                    request_current = False
                    connection.write(request)
                    connection.flush()
                    log_file.write(f"TX {request.hex(' ')}\n")
                    next_poll = now + args.interval

                chunk = connection.read(4096)
                if not chunk:
                    continue
                received.extend(chunk)
                rx_buffer.extend(chunk)
                log_file.write(f"RX {chunk.hex(' ')}\n")

                while b"\r" in rx_buffer:
                    end = rx_buffer.index(0x0D)
                    frame = bytes(rx_buffer[: end + 1])
                    del rx_buffer[: end + 1]
                    while rx_buffer.startswith(b"\n"):
                        del rx_buffer[0]
                    parsed = parse_frame(frame)
                    if parsed is not None:
                        decoded.append(parsed)
                        print(json.dumps(parsed, sort_keys=True), flush=True)
                        if args.measure and parsed.get("kind") == "status":
                            request_current = parsed.get("code") in ("030", "035")
                    else:
                        print(f"unrecognized frame: {frame.hex(' ')}", flush=True)
    finally:
        if args.measure and connection.is_open:
            connection.write(STANDBY_REQUEST)
            connection.flush()
            time.sleep(0.25)
        connection.close()
        bin_path.write_bytes(received)

    print(f"received={len(received)} bytes decoded_frames={len(decoded)}")
    print(f"raw={bin_path}")
    print(f"transcript={log_path}")
    return 0 if received else 2


if __name__ == "__main__":
    raise SystemExit(main())
