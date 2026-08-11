# PETC AWS infrastructure

Terraform provisions isolated UAT and production application resources while
reusing the account's existing networks.

## Topology

| Environment | Network | Database | Outbound NAT |
|---|---|---|---|
| UAT | `driving-school-uat` VPC | Existing `driving-school-uat-postgres`, separate `petc_uat` database and role | `47.131.161.253` |
| PROD | `driving-school-prod` VPC | New encrypted Multi-AZ `petc-prod-postgres` | `13.228.155.123` |

The two VPCs both use `10.40.0.0/16`, so they cannot be peered. UAT uses its
own NAT because government integration is mocked there. Production uses the
required allowlisted address.

Each environment creates its own ECS cluster/service, ALB, ECR repository,
security groups, frontend/photo/release buckets, CloudFront distribution,
certificates, secrets, monitoring, and GitHub deployment role.

## Retention

- Photos and desktop release objects: 1,095 days (three years).
- Production RDS automated backups: 35 days.
- Production AWS Backup recovery points: 1,095 days.
- Production logs: 365 days; UAT logs: 90 days.
- The shared UAT RDS keeps its existing backup policy because backing up the
  physical instance would also retain the driving-school workload.

## First deployment

The state bootstrap has been applied in account `016257615426`. Its own state
is stored at `s3://petc-terraform-state-016257615426/petc/bootstrap/terraform.tfstate`.
To inspect or update it from a trusted workstation:

```bash
cd infra/bootstrap
terraform init -backend-config=backend.hcl.example
terraform plan
```

Initialize each environment with its partial backend configuration:

```bash
cd infra/environments/uat
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Repeat from `infra/environments/prod` for production. The environment files
start with `bootstrap_mode = true`, so Terraform creates the ECS service at
zero tasks. This avoids trying to start an image or database login that does
not exist yet.

After the first infrastructure apply:

1. Copy the `deployment` output values into the corresponding GitHub
   environment variables listed below.
2. Push `release` for UAT or approve a `main` deployment for production. The
   workflow pushes the first image, runs the idempotent database bootstrap
   task, and starts the service.
3. Change `bootstrap_mode` to `false` and apply Terraform again. This makes the
   desired task count and autoscaling policy part of the managed steady state.

Do not commit `backend.hcl`; it is intentionally environment-local.

## GitHub environments

Create GitHub environments named `UAT` and `PROD`. Configure required reviewers
on `PROD`, then add these environment variables using the Terraform output:

- `AWS_DEPLOY_ROLE_ARN`
- `ECR_REPOSITORY`
- `ECS_CLUSTER`
- `ECS_SERVICE`
- `ECS_TASK_FAMILY`
- `DB_BOOTSTRAP_TASK_FAMILY`
- `ECS_PRIVATE_SUBNET_IDS` as a comma-separated list
- `ECS_SECURITY_GROUP_ID`
- `FRONTEND_BUCKET`
- `RELEASES_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`
- `API_URL`

No AWS access keys are stored in GitHub. The deployment roles trust the
account's existing GitHub Actions OIDC provider and only the matching branch or
GitHub environment.

## Database bootstrap

Terraform generates an application database password in Secrets Manager. An
idempotent Fargate task connects using the RDS-managed master secret, creates
or updates `petc_<environment>_app`, creates the environment database if
needed, and transfers database ownership to that application role. The normal
API task only receives the application password.

Flyway then applies application migrations when the API starts. Flyway's
PostgreSQL advisory lock serializes startup migrations if multiple production
tasks start together.

## Desktop releases

Every branch deployment packages Windows x64 and Apple Silicon macOS builds.
The workflow uploads installers, blockmaps, and Electron update metadata to:

- UAT: `/downloads/desktop/uat/`
- PROD: `/downloads/desktop/stable/`

The S3 bucket remains private; CloudFront makes these paths publicly readable.
The installers contain no center key. On first launch, an operator imports the
center-specific `petc.properties` downloaded from the portal.

Commissioning files currently set `petc.enforce.hardware=false` so UAT and the
initial production deployment can run against the government mock before live
hardware/government commissioning. Change it to `true` before accredited live
operation; production startup will then fail closed on mock adapters.

## LTMS deployment gates

The ECS task receives production-only LTMS settings from Terraform:

- `LTMS_MODE` selects the logical LTMS mode but never enables traffic by itself.
- `LTMS_OUTBOUND_ENABLED` permits any LTMS network request only when explicitly true.
- `LTMS_UPLOAD_ENABLED` separately permits mutating CEC upload/replacement calls.
- `LTMS_PRODUCTION_UPLOAD_ENABLED` is an additional disabled-by-default gate for production CEC upload/replacement calls.
- `LTMS_COMMISSIONING_APPROVED` records the separate approval required before production egress.
- `LTMS_ALLOWED_HOSTS`, `LTMS_PETC_BASE_URL`, and `LTMS_JWT_BASE_URL` define the exact HTTPS destinations.

Both UAT and production currently keep all enablement flags `false`. UAT uses
mock mode and therefore cannot contact LTMS. Production selects the only LTMS
environment that exists, but still cannot make a request until commissioning,
egress, upload, and production-upload settings are all explicitly enabled.

The current packages are unsigned. Windows displays an unknown-publisher
warning. macOS requires the operator to approve the quarantined application,
and automatic macOS updates should be considered unsupported until Apple code
signing and notarization are configured.
