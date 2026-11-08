-- LTMS confirmed that it exposes no QA/UAT environment. Retire any legacy QA
-- provisioning safely: it must be re-verified as production before use.
UPDATE ltms_center_configs
   SET environment = 'PRODUCTION',
       enabled = false,
       credential_verification_state = 'UNVERIFIED',
       credential_verified_at = NULL,
       updated_at = now()
 WHERE environment = 'QA';

ALTER TABLE ltms_center_configs
    DROP CONSTRAINT IF EXISTS ltms_center_configs_environment_check;
ALTER TABLE ltms_center_configs
    ADD CONSTRAINT ltms_center_configs_environment_check
    CHECK (environment = 'PRODUCTION');
