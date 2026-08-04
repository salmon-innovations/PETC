# PETC Data Flowchart

**Baseline:** DOTr Department Order No. 2023-008, Annex 6 / PETC Form 02

```mermaid
flowchart TD
    A[Operator login] --> B[Vehicle lookup through Digiflash cloud]
    B --> C[Start emission test]
    C --> D[Analyzer auto-detect and automatic reading capture]
    D --> E[Server-side reading validation]
    E --> F[Vehicle photos captured locally]
    F --> G[Photo SHA-256 calculated]
    G --> H[Cloud photo presign]
    H --> I[Photo upload to S3-compatible storage]
    I --> J[Cloud submission /api/submissions]
    J --> K[LTMS / IRDS submission from whitelisted cloud NAT IP]
    K --> L{Accepted?}
    L -->|Yes| M[CEC PDF generated]
    M --> N[CEC print / original receipt audit]
    N --> O[Optional controlled reprint audit]
    L -->|No| P[Reject or WAITING_FOR_LTMS]
    P --> Q[Incident workflow if realtime upload is not resolved]
```

## Data Stores

| Store | Data | Protection |
|---|---|---|
| Local SQLite | Test record, readings, photos metadata, audit log, print history | Workstation ACLs, loopback-only sidecar |
| Local filesystem | Captured photo bytes and CEC PDFs | Workstation ACLs |
| Cloud Postgres | Tenant/center authorization, numbered lanes, lane credentials, submissions, quota, audit/reporting data | Tenant/lane isolation, lane-credential auth, RLS where enabled |
| Object storage | Uploaded vehicle photos | Presigned PUT, tenant/lane/test scoped object keys |
