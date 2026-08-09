module "petc" {
  source = "../../modules/environment"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment             = "uat"
  aws_region              = "ap-southeast-1"
  vpc_id                  = "vpc-0e242a6c7cfac205c"
  public_subnet_ids       = ["subnet-08af5c9a812328e9d", "subnet-0241dbeadd013c5f1"]
  private_subnet_ids      = ["subnet-0fffe2629787d03f0", "subnet-05b131cd61812d622"]
  frontend_domain         = "uat-app.petc.siiportal.com"
  api_domain              = "uat-api.petc.siiportal.com"
  github_branch           = "release"
  github_environment_name = "UAT"
  spring_profile          = "uat"
  government_mock         = true
  government_require_live = false
  service_desired_count   = 1
  bootstrap_mode          = false
  log_retention_days      = 90
  object_retention_days   = 1095

  create_rds                     = false
  existing_rds_endpoint          = "driving-school-uat-postgres.cd6aggqyq8qp.ap-southeast-1.rds.amazonaws.com"
  existing_rds_security_group_id = "sg-0da35f300620895d6"
  existing_rds_master_secret_arn = "arn:aws:secretsmanager:ap-southeast-1:016257615426:secret:rds!db-7668e6f8-0afe-41af-8eea-24996a7bc43f-AN7AQR"
  existing_rds_master_username   = "postgres"
  application_database_name      = "petc_uat"
  enable_long_term_rds_backup    = false
}
