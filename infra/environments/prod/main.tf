module "petc" {
  source = "../../modules/environment"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment             = "prod"
  aws_region              = "ap-southeast-1"
  vpc_id                  = "vpc-0f273870cd2a0be55"
  public_subnet_ids       = ["subnet-0287e9c1d26c8c24a", "subnet-0ad01e5ebf19c488f"]
  private_subnet_ids      = ["subnet-0ef4f5609ed37bb0b", "subnet-0916da6194bc63439"]
  frontend_domain         = "petc.siiportal.com"
  api_domain              = "app.petc.siiportal.com"
  github_branch           = "main"
  github_environment_name = "PROD"
  spring_profile          = "production"
  government_mock         = true
  government_require_live = false
  # LTMS exposes production only. Selecting that target does not permit
  # traffic: every egress and mutation gate below remains disabled.
  ltms_mode             = "production"
  ltms_outbound_enabled = false
  ltms_upload_enabled   = false
  # Keep production CEC mutations independently disabled until an approved
  # production commissioning explicitly enables this deployment gate.
  ltms_production_upload_enabled = false
  ltms_commissioning_approved    = false
  # Populate these only during approved production commissioning.
  ltms_allowed_hosts    = []
  ltms_petc_base_url    = ""
  ltms_jwt_base_url     = ""
  service_desired_count = 2
  bootstrap_mode        = true
  log_retention_days    = 365
  object_retention_days = 1095

  create_rds                  = true
  application_database_name   = "petc_prod"
  rds_instance_class          = "db.t4g.small"
  rds_engine_version          = "18.3"
  rds_multi_az                = true
  rds_deletion_protection     = true
  enable_long_term_rds_backup = true
}
