# CARTESYKJ MQY-200 diesel capture

Implementation: `desktop/sidecar/petc/analyzer/cartesykj_desiel.py`.
The requested filename spelling is retained; the class is `CartesykjDieselAnalyzer`.
Settings accept `cartesykj_diesel` and `cartesykj_desiel`.

## Source inspected

- `CartesySource/app.py`: `run_sequence`, `collect_realtime_samples`, `get_test_result`.
- `CartesySource/mqy200_protocol.py` and `serial_win.py`.
- Both supplied PDFs: final integration documentation and sample K computation.
- Earlier static disassembly of the supplied V12 executable is in this directory.

## Capturing the six values

1. Open COM at 9600 baud, 8N1, 0.25-second read and 1-second write timeout.
2. Send `A0 01 5F`; wait 2 seconds. Drain input.
3. Send `A2 5E`; wait 5 seconds. Drain input.
4. For each of six cycles, issue five groups of five sequential `A6 5A`
   requests. Each response has a 0.45-second deadline; wait 0.2 seconds after
   each request and at least one second per group. Slow replies extend sampling.
5. Accept only 10-byte responses beginning with `A6`. Decode unsigned
   big-endian bytes `[3:5]` and divide by 100. Other bytes are not interpreted;
   the vendor source does not validate a checksum.
6. Keep the maximum valid K in each cycle, not the mean of its samples.
   The countdown is inclusive 10 through 0: five acceleration seconds and
   six release seconds. Normal total duration is approximately 73 seconds.
7. Display T1 through T6, then enable **Get Test Result**. Only that action
   validates and reveals `round(sum(peaks) / 6, 2)`.

PDF example: peaks 14.29, 13.85, 14.10, 13.72, 14.25, 13.95 give **14.03**.
Individual zero samples/peaks are retained. A zero final average or an average
already accepted on the same local calendar day is rejected at retrieval.
Duplicate tracking lives in the adapter instance, like the source application's
session-memory rule; restarting/replacing the adapter clears it.

## Integration and intentional differences

Select **CARTESYKJ MQY-200 Diesel Analyzer** in desktop Settings, choose the
COM port and save/reconnect. Start a Diesel test, follow the pedal countdown,
review the six maxima, and press **Get Test Result**.

Progress uses HTTP 202 from `/test/{token}/result`. Completed capture also
returns 202 until `accept_result=true` is requested. Accepted results retain
all valid raw frames; the audit/cloud payload also retains per-cycle samples,
responses, and maxima. The existing short result-read timing check remains;
the long six-cycle acquisition occurs before final retrieval.

- No replies is an error, not a fabricated zero cycle as in the reference.
- A single worker completes each cycle before the next begins. Unlike the
  reference's bounded sampler join, slow sampling cannot bleed into another cycle.
- Pending input is cleared before each request to discard buffered stale replies.
  This protocol has no request identifier, so a late reply arriving after a new
  request cannot be reliably distinguished at the protocol level.
- Cancellation is checked before I/O and throughout waits; overlapping sessions
  are refused. Serial I/O failures stop the sequence.
- Only K is documented. Opacity and RPM stay unknown; no conversions are invented.
  Existing LTMS completeness rules still require fields unavailable from this
  source, so this is not proof of submission readiness or accreditation compliance.

## Verification

Automated serial simulations cover fragmented frames, 150 requests, six maxima,
the PDF average, deferred zero/duplicate validation, invalid replies and cancellation.
The API test verifies progress does not publish a result before acceptance.
A physical MQY-200 comparison is still required; no hardware was operated here.

## Live diesel panel

Selecting Diesel on Run Test displays the instrument panel before starting:
large current K and countdown, pedal status, current test number, valid/invalid
sample counts, six peak cards, and a per-test result log. The camera remains
visible at a smaller size. Progress is polled every 200 ms; values originate
from the adapter's capture state. Get Test Result reveals the average only
after all six cycles finish.

The desktop requests `diesel_sequence=true` on diesel test start. With the mock
analyzer this opts into a clearly labeled, deterministic 73-second simulation
of calibration, six countdowns and sample updates. It uses no physical analyzer
and retains the existing MOCK raw marker. Other API clients keep the existing
immediate mock behavior unless they opt in. Physical MQY-200 captures use actual
serial samples. Other physical analyzer protocols do not gain synthetic cycles.

Restart the desktop and Python sidecar after updating to load both the panel
and backend progress changes.
