r"""Passively capture an analyzer's serial output for protocol discovery.

This utility never writes to the serial port. It stores the exact received bytes
in a ``.bin`` file and a timestamped, human-readable hex/ASCII transcript in a
``.log`` file. DTR and RTS are disabled before the port is opened so merely
listening is as non-invasive as the USB adapter permits.

Examples (run from ``desktop``)::

    .venv\Scripts\python.exe tools\capture_serial.py COM3 --baud 9600 --duration 30
    .venv\Scripts\python.exe tools\capture_serial.py COM3 --scan --dwell 2
"""
from __future__ import annotations

import argparse
import json
import string
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import serial


@dataclass(frozen=True)
class SerialConfig:
    baud: int
    data_bits: int
    parity: str
    stop_bits: int

    @property
    def label(self) -> str:
        return f"{self.baud}-{self.data_bits}{self.parity}{self.stop_bits}"


COMMON_CONFIGS = (
    SerialConfig(1200, 7, "N", 1),
    SerialConfig(1200, 8, "N", 1),
    SerialConfig(2400, 8, "N", 1),
    SerialConfig(4800, 8, "N", 1),
    SerialConfig(9600, 8, "N", 1),
    SerialConfig(9600, 7, "E", 1),
    SerialConfig(19200, 8, "N", 1),
    SerialConfig(38400, 8, "N", 1),
    SerialConfig(57600, 8, "N", 1),
    SerialConfig(115200, 8, "N", 1),
)

_BYTE_SIZES = {7: serial.SEVENBITS, 8: serial.EIGHTBITS}
_PARITIES = {
    "N": serial.PARITY_NONE,
    "E": serial.PARITY_EVEN,
    "O": serial.PARITY_ODD,
}
_STOP_BITS = {1: serial.STOPBITS_ONE, 2: serial.STOPBITS_TWO}


def _open_passive(
    port: str,
    config: SerialConfig,
    *,
    dtr: bool = False,
    rts: bool = False,
) -> serial.Serial:
    # Construct the object while closed so DTR/RTS can be disabled before the
    # Windows driver opens the physical port.
    connection = serial.Serial(
        port=None,
        baudrate=config.baud,
        bytesize=_BYTE_SIZES[config.data_bits],
        parity=_PARITIES[config.parity],
        stopbits=_STOP_BITS[config.stop_bits],
        timeout=0.1,
    )
    connection.dtr = dtr
    connection.rts = rts
    connection.port = port
    connection.open()
    connection.reset_input_buffer()
    return connection


def _ascii_preview(data: bytes) -> str:
    printable = set(string.printable.encode("ascii"))
    return "".join(chr(value) if value in printable and value not in b"\r\n\t" else "." for value in data)


def capture(
    port: str,
    config: SerialConfig,
    duration: float,
    output_dir: Path,
    *,
    dtr: bool = False,
    rts: bool = False,
) -> tuple[int, Path, Path]:
    started = datetime.now(timezone.utc)
    safe_port = "".join(c if c.isalnum() or c in "-_" else "_" for c in port)
    stem = f"{started.strftime('%Y%m%dT%H%M%S.%fZ')}_{safe_port}_{config.label}"
    binary_path = output_dir / f"{stem}.bin"
    log_path = output_dir / f"{stem}.log"
    output_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    deadline = time.monotonic() + duration
    connection = _open_passive(port, config, dtr=dtr, rts=rts)
    try:
        with binary_path.open("wb") as binary_file, log_path.open("w", encoding="utf-8") as log_file:
            metadata = {
                "port": port,
                **asdict(config),
                "started_utc": started.isoformat(),
                "duration_seconds": duration,
                "writes_sent": 0,
                "dtr": dtr,
                "rts": rts,
            }
            log_file.write(json.dumps(metadata, sort_keys=True) + "\n")

            while time.monotonic() < deadline:
                chunk = connection.read(4096)
                if not chunk:
                    continue
                elapsed = duration - max(0.0, deadline - time.monotonic())
                total += len(chunk)
                binary_file.write(chunk)
                log_file.write(
                    f"+{elapsed:09.3f}s {len(chunk):4d} bytes "
                    f"{chunk.hex(' ')} |{_ascii_preview(chunk)}|\n"
                )
                binary_file.flush()
                log_file.flush()
    finally:
        connection.close()

    return total, binary_path, log_path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="Serial port, for example COM3")
    parser.add_argument("--baud", type=int, default=9600)
    parser.add_argument("--data-bits", type=int, choices=(7, 8), default=8)
    parser.add_argument("--parity", choices=("N", "E", "O"), default="N")
    parser.add_argument("--stop-bits", type=int, choices=(1, 2), default=1)
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument(
        "--dtr",
        action="store_true",
        help="Assert DTR while listening (some instruments require this control line)",
    )
    parser.add_argument(
        "--rts",
        action="store_true",
        help="Assert RTS while listening (some instruments require this control line)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "petc-serial-captures",
    )
    parser.add_argument(
        "--scan",
        action="store_true",
        help="Passively sample common configurations; useful only for a continuously transmitting device",
    )
    parser.add_argument("--dwell", type=float, default=2.0, help="Seconds per configuration during --scan")
    return parser


def main() -> int:
    args = _parser().parse_args()
    configs = COMMON_CONFIGS if args.scan else (
        SerialConfig(args.baud, args.data_bits, args.parity, args.stop_bits),
    )
    duration = args.dwell if args.scan else args.duration
    if duration <= 0:
        raise SystemExit("capture duration must be positive")

    print(
        f"Passive receive only on {args.port}; no serial data commands will be sent "
        f"(DTR={'on' if args.dtr else 'off'}, RTS={'on' if args.rts else 'off'}).",
        flush=True,
    )
    found = 0
    for config in configs:
        print(f"Listening at {config.label} for {duration:g}s ...", flush=True)
        try:
            count, binary_path, log_path = capture(
                args.port,
                config,
                duration,
                args.output_dir,
                dtr=args.dtr,
                rts=args.rts,
            )
        except serial.SerialException as exc:
            print(f"Unable to open/read {args.port}: {exc}", file=sys.stderr)
            return 1
        print(f"  received {count} bytes; raw={binary_path}; transcript={log_path}", flush=True)
        found += count

    if found == 0:
        print("No bytes received. The analyzer may transmit only after PRINT or after a request command.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
