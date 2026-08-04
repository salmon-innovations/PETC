# Network Diagram — Companion to Deliverable #6

This folder holds the one-page AWS network diagram that accompanies the textual deliverable [`../06-network-architecture.md`](../06-network-architecture.md).

| File | Purpose |
|---|---|
| `network-diagram.mmd` | Mermaid source. Edit this; the PNG and SVG are generated from it. |
| `network-diagram.png` | 2400 × 2200 PNG render at white background. Suitable for printing and pasting into Word / PDF accreditation packets. |
| `network-diagram.svg` | Vector render. Use for resizing without loss when the deliverable is exported via Pandoc or LaTeX. |

## Reading the diagram

The page is organised top-to-bottom in three bands:

1. **CLIENTS** — PETC lane desktops (left) and the Operator portal users (right). A center may have multiple numbered lanes; each desktop authenticates with its lane-specific `X-Center-Key` credential, from which the cloud derives the trusted center and lane. Portal users authenticate with a JWT issued by `/api/auth/login`.

2. **AWS — Digiflash Cloud (`ap-southeast-1`)** — the production target footprint. Inside the VPC: public subnets host the ALB and NAT Gateway; app private subnets host the Spring Boot ECS Fargate tasks and the Submission Job Runner; data private subnets host RDS Postgres Multi-AZ, ElastiCache Redis Multi-AZ, the S3 Gateway Endpoint and the Secrets Manager Interface Endpoint (so neither S3 nor Secrets Manager traffic ever leaves the AWS backbone). The "Managed services" row beneath the VPC lists the AWS services consumed through those endpoints: S3 (`petc-photos`), Secrets Manager (LTMS / IRDS credentials and the JWT signing key), and CloudWatch (logs, metrics, alarms).

3. **GOVERNMENT REGISTRIES** — LTMS (LTO) and IRDS (Stradcom). The two thick red arrows from the NAT Gateway down to LTMS and IRDS represent the only outbound paths from the platform to government systems, and the **same single Elastic IP** is what LTMS and IRDS whitelist.

## Notable arrows

- **Dashed PETC → S3 lines** — desktops upload photo bytes directly to S3 with a presigned PUT (TTL ≤ 300 s) returned by `POST /api/photos/presign`. Photo bytes never transit the API server.
- **Thick red NAT → LTMS / IRDS lines** — the only egress from AWS to government. Whitelisted at the LTMS / IRDS firewall by IP, never by individual PETC.
- **JOB → NAT (labelled "LTMS submit")** — the background `SubmissionJobRunner` is the only code path that triggers calls to LTMS. Operator-portal traffic and ALB-handled API calls never reach the NAT.

## Pilot vs target

The diagram describes the **target production footprint** described in `../06-network-architecture.md` §10. The current pilot footprint runs a single ECS task, a single Postgres instance, no Redis or WAF, and a single NAT Gateway, but the boundary controls (single whitelisted NAT IP, RLS tenant isolation, X-Center-Key auth, S3 presigned-URL photo path) are identical between pilot and production.

## Regenerating the renders

```bash
cd docs/accreditation/06-network-architecture
mmdc -i network-diagram.mmd -o network-diagram.png --width 2400 --height 2200 --backgroundColor white
mmdc -i network-diagram.mmd -o network-diagram.svg --backgroundColor white
```

`mmdc` is `@mermaid-js/mermaid-cli`; install with `npm install -g @mermaid-js/mermaid-cli` (≈150 MB, pulls Chromium).
