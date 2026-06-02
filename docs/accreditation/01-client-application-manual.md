# Client Application Program Manual

**Digiflash – PETC Data Submission Client**

DOTr IT Provider Accreditation – Deliverable #1

---

## Document Control

| Field | Value |
|---|---|
| Document title | Client Application Program Manual – Digiflash PETC Data Submission Client |
| Document version | 0.1 (Draft) |
| Document date | 2026-06-02 |
| Product name | Digiflash |
| IT Provider | Salmon Innovations |
| Prepared by | Christian Deiniel Y. Silerio |
| Prepared for | Department of Transportation (DOTr) / Land Transportation Office (LTO) |
| Audience | Trained PETC operators (encoders and supervisors) |
| Language | English |

### Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-06-02 | C. Silerio | Initial draft for DOTr accreditation submission. |

---

## 1. Introduction

### 1.1 Purpose

This manual describes the day-to-day operation of the **Digiflash PETC Data Submission Client** at an accredited Private Emission Testing Center. It is written for the operators who will actually run the application — encoders and supervisors — and is structured so a new operator can complete a full emission test from login to printed CEC by following the procedures in order.

### 1.2 Product Overview

Digiflash is a Windows desktop application installed at each accredited PETC. It:

1. Captures emission readings from the connected analyzer (Fofen petrol gas analyzer or Fofen diesel opacimeter at the pilot center).
2. Photographs the vehicle and operator workstation through a USB webcam.
3. Looks up vehicle and owner data from LTMS / IRDS.
4. Combines all of the above into a single emission test record.
5. Submits the completed record to LTMS and IRDS through the Digiflash cloud service.
6. Prints a Certificate of Emission Compliance (CEC) for the vehicle owner on a thermal receipt printer.

The desktop application is the source of truth at the center. A center can continue capturing tests during a temporary internet outage; queued tests will be uploaded automatically when connectivity is restored.

### 1.3 Roles

| Role | Allowed actions |
|---|---|
| **Encoder** | Log in, run tests, capture photos, complete the LTMS upload wizard, print CECs, view own test history. |
| **Supervisor / Admin** | All encoder actions plus: manage operator accounts at the center, configure analyzer / camera / printer, review and re-print past CECs, view the daily summary report. |
| **Platform Super Admin** | Operator-cloud only; not available inside the desktop application. |

---

## 2. System Requirements

### 2.1 Workstation

| Item | Minimum specification |
|---|---|
| Operating System | Windows 10 (64-bit, version 21H2 or newer) or Windows 11 |
| CPU | Intel Core i3 (10th gen) or AMD Ryzen 3 (3000 series) |
| RAM | 8 GB |
| Storage | 256 GB SSD with at least 50 GB free |
| USB ports | 3 free USB-A ports (analyzer adapter, webcam, printer) |
| Display | 1366 × 768 minimum (1920 × 1080 recommended) |
| Internet | Stable broadband, minimum 5 Mbps down / 2 Mbps up |
| Power | UPS with at least 30 minutes of runtime at idle PC + monitor + printer |

### 2.2 Peripherals at the Testing Bay

| Item | Specification |
|---|---|
| Emission analyzer | Fofen petrol gas analyzer (gas vehicles) and Fofen diesel opacimeter (diesel vehicles), connected via USB-to-Serial adapter |
| Webcam | USB 2.0 webcam, 1080p (2 MP), fixed focus, ≥60° field of view, ≤1 lux low-light. See `02-setup-and-network-layout.md` §4 for the functional-compliance basis. |
| Receipt printer | 80 mm thermal receipt printer, USB, ESC/POS-compatible |
| Network | Wired Ethernet preferred; Wi-Fi acceptable with a strong signal |

---

## 3. Installation

> Installation is performed by the Digiflash field engineer during initial PETC commissioning. Operators do not normally need to install the software themselves; this section is included for completeness.

### 3.1 Steps

1. Sign in to Windows with an administrator account.
2. Run the installer `Digiflash-PETC-Setup-<version>.exe` provided by Digiflash.
3. Accept the license terms and proceed through the installer.
4. When prompted, enter the **Center ID** and **Center API Key** issued by Digiflash.
5. Choose the install location (default `C:\Program Files\Digiflash`) and complete the installer.
6. The installer creates a desktop shortcut named **Digiflash PETC**.
7. Reboot if prompted.

### 3.2 First Launch

On first launch, the application performs a self-check and may prompt for:

- The COM port and baud rate of the Fofen analyzer.
- The USB device of the webcam.
- The USB device of the thermal printer.

These settings are saved and do not need to be re-entered.

> **Screenshot placeholder 3.2** – Installer welcome screen and first-launch self-check.

---

## 4. Logging In

### 4.1 Operator Login

1. Double-click the **Digiflash PETC** shortcut to launch the application.
2. The login screen appears.
3. Enter your registered **email** and **password**.
4. Click **Sign In**.

If your credentials are correct, you are taken to the home screen. If they are incorrect, an inline error message is shown; after five consecutive failures the account is temporarily locked for 15 minutes.

> **Screenshot placeholder 4.1** – Login screen with empty fields.

### 4.2 Forgotten Password

Ask the center supervisor to reset your password from the **Settings → Operators** screen. Password resets are not self-service on the desktop application.

### 4.3 Logging Out

Click the operator name in the top-right corner of any screen and choose **Sign Out**. The application returns to the login screen and the local session token is discarded.

---

## 5. Home Screen Overview

After login, the home screen shows:

- The current operator and role in the top-right.
- The center name in the top-left.
- A primary action button: **Run Test**.
- A secondary navigation strip with: **Run Test**, **LTMS Upload**, **History**, **Analytics**, **Settings**.
- A status bar at the bottom showing analyzer connection status, printer status, and cloud sync status.

> **Screenshot placeholder 5** – Home screen with status bar at the bottom.

### 5.1 Status Bar Indicators

| Indicator | Healthy state | What it means if unhealthy |
|---|---|---|
| Analyzer | Green: connected | Red: analyzer COM port not opened; check the cable. |
| Camera | Green: detected | Red: webcam not detected; re-plug USB. |
| Printer | Green: ready | Red: printer offline, no paper, or driver issue. |
| Cloud | Green: synced | Yellow: backlog of tests waiting to upload; will auto-retry. Red: cloud unreachable; tests are still saved locally. |

---

## 6. Running an Emission Test

This is the core daily workflow.

### 6.1 Starting a Test

1. From the home screen, click **Run Test**.
2. Enter the vehicle's plate number in the **Plate Number** field.
3. Click **Look Up**. Digiflash queries LTMS / IRDS through the cloud and pre-fills the vehicle and owner details.
   - If the plate is not found, choose **Continue without lookup** to enter details manually.
4. Choose the fuel type:
   - **Gasoline** routes the test to the Fofen petrol gas analyzer.
   - **Diesel** routes the test to the Fofen diesel opacimeter.
5. Click **Start Test**.

> **Screenshot placeholder 6.1** – Run Test screen, plate lookup completed.

### 6.2 Capturing Analyzer Readings

After clicking **Start Test**, Digiflash opens the connection to the configured analyzer and begins receiving readings.

For **gasoline** tests, the following fields are captured: CO, HC, CO₂, O₂, λ (lambda), engine RPM, oil temperature, analyzer serial number, and the analyzer's pass/fail indication.

For **diesel** tests, the following fields are captured: opacity (%), k-value (m⁻¹), engine RPM, boost pressure, analyzer serial number, and the analyzer's pass/fail indication.

The screen updates live until the analyzer signals end-of-test. The final accepted reading is then displayed.

If the analyzer disconnects or returns no data within 60 seconds, an error banner appears with the suggested fix.

> **Screenshot placeholder 6.2** – Live analyzer readings during a diesel test.

### 6.3 Capturing Photos

After analyzer readings are captured:

1. Position the vehicle so the rear plate is visible in the webcam preview.
2. Click **Capture Photo**.
3. Repeat to capture at least:
   - One photo showing the vehicle and rear plate.
   - One photo showing the vehicle at the testing bay.

Each photo is stored locally and tagged with a SHA-256 hash, the test ID, the operator ID, and a timestamp.

> **Screenshot placeholder 6.3** – Photo capture screen with two captures visible.

### 6.4 Saving the Test

Click **Save Test**. The test is saved to the local database with status **Pending Upload**. You can now either:

- Continue to **LTMS Upload** to submit the test immediately, or
- Return to the home screen and submit later from the **LTMS Upload** queue.

---

## 7. LTMS Upload Wizard

The LTMS Upload wizard takes a saved test through a six-step review before submission. It is mandatory for every test.

### 7.1 Opening the Wizard

1. From the navigation strip, click **LTMS Upload**.
2. A list of pending tests is shown, newest first.
3. Click the row of the test you want to submit.

> **Screenshot placeholder 7.1** – Pending uploads list.

### 7.2 Step 1 – Vehicle Details

Review and correct (if needed) the vehicle's plate number, make, model, year, fuel type, engine displacement, and MV file number. Click **Next**.

> **Screenshot placeholder 7.2** – Wizard Step 1, vehicle details.

### 7.3 Step 2 – Owner Details

Review the owner's name, address, contact number, and ID type. For organisation-owned vehicles, the organisation name is shown in addition to the authorised representative. Click **Next**.

> **Screenshot placeholder 7.3** – Wizard Step 2, owner details.

### 7.4 Step 3 – Engine Flags and Readings

Review the captured analyzer readings shown above the engine flags. Set:

- Engine condition flags (visible smoke, oil leaks, tampering).
- Final pass / fail determination, which defaults to the analyzer's own determination.

Click **Next**.

> **Screenshot placeholder 7.4** – Wizard Step 3, engine flags and readings.

### 7.5 Step 4 – Technician and Certification

Select your technician name and license number from the drop-down. The certification statement is shown verbatim and must be acknowledged with a checkbox. Click **Next**.

> **Screenshot placeholder 7.5** – Wizard Step 4, technician and certification.

### 7.6 Step 5 – Photos

Confirm that at least one **front** and one **rear** photo are attached. If a photo is missing, click **Add Photo** to capture an additional one from the webcam. Click **Next**.

> **Screenshot placeholder 7.6** – Wizard Step 5, photos.

### 7.7 Step 6 – Review and Submit

The final screen shows a read-only summary of all data going to LTMS and IRDS. Verify carefully. Click **Submit to LTMS**.

The wizard shows a progress indicator while the Digiflash cloud submits the record to LTMS and IRDS on behalf of the center.

> **Screenshot placeholder 7.7** – Wizard Step 6, review and submit.

### 7.8 Outcomes

| Outcome | What you will see | What to do |
|---|---|---|
| **Accepted** | A green confirmation with the CEC number (`CERT-…`) and the option **Print CEC**. | Print the CEC and hand it to the vehicle owner. |
| **Rejected** | A red banner showing the rejection reason returned by LTMS/IRDS. | Correct the noted issue, then re-submit from the **LTMS Upload** queue. |
| **Queued (offline)** | A yellow banner: "Saved. Will upload when connection is restored." | Continue working; the upload will retry automatically. |

> **Screenshot placeholder 7.8** – Accepted result with print button.

---

## 8. Printing the CEC

### 8.1 Printing After Submission

When LTMS accepts the test, click **Print CEC** on the result screen. A two-copy receipt is produced on the 80 mm thermal printer:

1. **Customer copy** – given to the vehicle owner.
2. **LTO copy** – retained at the center.

### 8.2 Re-printing a CEC

1. From the navigation strip, click **History**.
2. Find the test by plate number, date, or CEC number.
3. Open the test row.
4. Click **Re-print CEC**.

Re-prints are logged in the audit trail with the operator ID and timestamp.

> **Screenshot placeholder 8.2** – History row with re-print button.

---

## 9. History and Daily Summary

### 9.1 History

The **History** screen lists every test conducted at this center, with filters for date range, plate number, fuel type, and result. Encoders see only their own tests by default; supervisors see all tests at the center.

### 9.2 Daily Summary (Supervisor only)

Open **Analytics → Daily Summary**. The page shows:

- Total tests today, broken down by gas vs diesel.
- Pass / fail count.
- Number of LTMS submissions accepted, rejected, and still queued.
- Operator-level activity.

These numbers reset at midnight (PHT).

> **Screenshot placeholder 9.2** – Daily summary screen.

---

## 10. Settings

The **Settings** screen is available to supervisors and admins only.

### 10.1 Operators

Add, deactivate, or reset the password for operator accounts at this center. Encoders cannot be promoted to supervisor from the desktop application.

### 10.2 Analyzer

Choose the analyzer adapter (Fofen gas, Fofen diesel, or other supported brands), the COM port, and the baud rate. Click **Test Connection** to verify before saving.

### 10.3 Camera

Pick the webcam from the dropdown of detected video devices, then click **Preview**.

### 10.4 Printer

Pick the receipt printer and click **Print Test Page**.

### 10.5 Cloud

Read-only view of the Center ID, the masked center API key, and the most recent sync timestamp. To change the API key, contact Digiflash support.

> **Screenshot placeholder 10** – Settings landing page.

---

## 11. Troubleshooting

The fixes below cover the most common day-to-day issues. Anything not listed here should be escalated to Digiflash support (Section 12).

### 11.1 Analyzer status shows Red

1. Check the USB-to-Serial cable between the analyzer and the PC.
2. Open **Settings → Analyzer** and confirm the COM port. If the port number has changed (Windows occasionally re-assigns COM numbers), update and save.
3. Power-cycle the analyzer and click **Test Connection** again.

### 11.2 Webcam not detected

1. Re-plug the webcam into a different USB port.
2. Open Windows **Device Manager** and confirm the webcam appears under **Cameras**. If it shows a warning icon, install or update the driver.
3. Restart Digiflash.

### 11.3 Printer offline or paper-out

1. Replace the receipt roll if paper-out.
2. Power-cycle the printer.
3. Open **Settings → Printer**, click **Print Test Page**.
4. If the test page does not print, check the USB cable.

### 11.4 LTMS submission rejected

The rejection banner shows the reason text returned by LTMS or IRDS. Common reasons:

| Reason text contains | Fix |
|---|---|
| "Vehicle not found" | Re-verify the plate number and re-submit; if still unfound, capture the issue and contact the vehicle owner to confirm the LTMS record. |
| "Owner mismatch" | Re-check owner details against the LTMS lookup. |
| "Duplicate submission" | The test was already submitted; open **History** to find the existing CEC and re-print if needed. |
| "Certification missing" | Return to Step 4 of the wizard and re-confirm the technician acknowledgement. |

### 11.5 Cloud status stays Yellow for a long time

Yellow means the desktop is saving tests locally but the Digiflash cloud is not reachable. This is normal during a temporary internet outage; tests will upload automatically when connectivity is restored. If the status stays yellow for more than one business day:

1. Check the center's internet connection (open a browser and load any website).
2. Open **Settings → Cloud** and verify the last sync timestamp.
3. If both internet and timestamp look normal, contact Digiflash support.

### 11.6 Application will not start

1. Reboot the PC.
2. If the issue persists, run the **Digiflash Repair** entry from the Start menu, which restarts the embedded services.
3. If the application still does not start, contact Digiflash support and quote the error message.

---

## 12. Support

| Channel | Detail |
|---|---|
| Provider | Salmon Innovations (DOTr-accredited IT Provider) |
| Product | Digiflash |
| Email | _to be provided_ |
| Phone / Hotline | _to be provided_ |
| Support hours | Monday – Saturday, 08:00 – 18:00 PHT |
| Emergency escalation | _to be provided_ |

> **Note for final submission:** Fill in the support contact rows before submitting this manual to DOTr.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **CEC** | Certificate of Emission Compliance. The printed certificate issued to the vehicle owner after a passing test. |
| **Center API Key** | A per-center credential that identifies the desktop application to the Digiflash cloud. |
| **Encoder** | A PETC operator who runs tests but cannot manage other operators. |
| **IRDS** | Stradcom Integrated Records and Document System. |
| **LTMS** | Land Transportation Management System, operated by LTO. |
| **MV File Number** | The Motor Vehicle file number assigned by LTO to each registered vehicle. |
| **Outbox** | The local queue of tests waiting to be uploaded to the Digiflash cloud. |
| **Pending Upload** | Test status after capture and before successful LTMS submission. |
| **PETC** | Private Emission Testing Center. |
| **Supervisor** | A PETC operator with rights to manage other operators and configure hardware. |

---

*End of Client Application Program Manual – Digiflash PETC Data Submission Client.*
