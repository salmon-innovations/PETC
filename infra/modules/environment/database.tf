resource "aws_security_group" "rds" {
  count = var.create_rds ? 1 : 0

  name        = "${local.name}-rds-sg"
  description = "PostgreSQL access for ${local.name}"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-rds-sg" })
}

resource "aws_db_subnet_group" "main" {
  count = var.create_rds ? 1 : 0

  name       = "${local.name}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = merge(local.common_tags, { Name = "${local.name}-db-subnets" })
}

resource "aws_db_instance" "main" {
  count = var.create_rds ? 1 : 0

  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = var.rds_engine_version
  instance_class = var.rds_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = var.application_database_name
  username                    = "petc_admin"
  manage_master_user_password = true
  port                        = 5432

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.rds[0].id]
  publicly_accessible    = false
  multi_az               = var.rds_multi_az

  backup_retention_period    = 35
  backup_window              = "18:00-19:00"
  maintenance_window         = "sun:19:00-sun:20:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  deletion_protection       = var.rds_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-postgres-final"
  copy_tags_to_snapshot     = true

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring[0].arn

  tags = merge(local.common_tags, { Name = "${local.name}-postgres" })
}

resource "aws_iam_role" "rds_monitoring" {
  count = var.create_rds ? 1 : 0
  name  = "${local.name}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count      = var.create_rds ? 1 : 0
  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "database_password" {
  name                    = "${local.name}/database-password"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database_password" {
  secret_id     = aws_secretsmanager_secret.database_password.id
  secret_string = random_password.database.result
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/jwt-secret"
  recovery_window_in_days = var.environment == "prod" ? 30 : 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_backup_vault" "rds" {
  count = var.create_rds && var.enable_long_term_rds_backup ? 1 : 0
  name  = "${local.name}-rds-backups"
  tags  = local.common_tags
}

resource "aws_backup_plan" "rds" {
  count = var.create_rds && var.enable_long_term_rds_backup ? 1 : 0
  name  = "${local.name}-rds-three-year"

  rule {
    rule_name         = "daily-three-year-retention"
    target_vault_name = aws_backup_vault.rds[0].name
    schedule          = "cron(0 20 * * ? *)"

    lifecycle { delete_after = var.object_retention_days }
  }
  tags = local.common_tags
}

resource "aws_iam_role" "backup" {
  count = var.create_rds && var.enable_long_term_rds_backup ? 1 : 0
  name  = "${local.name}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  count      = var.create_rds && var.enable_long_term_rds_backup ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_selection" "rds" {
  count        = var.create_rds && var.enable_long_term_rds_backup ? 1 : 0
  name         = "${local.name}-rds"
  iam_role_arn = aws_iam_role.backup[0].arn
  plan_id      = aws_backup_plan.rds[0].id
  resources    = [aws_db_instance.main[0].arn]
}
