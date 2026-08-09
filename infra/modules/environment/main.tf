data "aws_caller_identity" "current" {}

data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

locals {
  name = "petc-${var.environment}"

  common_tags = {
    Project     = "petc"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  frontend_bucket_name = "${local.name}-frontend-${data.aws_caller_identity.current.account_id}"
  photo_bucket_name    = "${local.name}-photos-${data.aws_caller_identity.current.account_id}"
  release_bucket_name  = "${local.name}-releases-${data.aws_caller_identity.current.account_id}"

  database_endpoint = var.create_rds ? aws_db_instance.main[0].address : var.existing_rds_endpoint
  database_port     = 5432
  database_sg_id    = var.create_rds ? aws_security_group.rds[0].id : var.existing_rds_security_group_id
  master_secret_arn = var.create_rds ? aws_db_instance.main[0].master_user_secret[0].secret_arn : var.existing_rds_master_secret_arn
  master_username   = var.create_rds ? aws_db_instance.main[0].username : var.existing_rds_master_username

  database_url = "jdbc:postgresql://${local.database_endpoint}:${local.database_port}/${var.application_database_name}"
}
