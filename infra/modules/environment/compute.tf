resource "aws_ecr_repository" "backend" {
  name                 = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest 60 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 60
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "db_bootstrap" {
  name              = "/ecs/${local.name}-db-bootstrap"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb-sg"
  description = "Public HTTPS access to ${local.name}"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-alb-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "ecs" {
  name        = "${local.name}-ecs-sg"
  description = "Fargate tasks for ${local.name}"
  vpc_id      = var.vpc_id
  tags        = merge(local.common_tags, { Name = "${local.name}-ecs-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "ecs" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_ecs" {
  security_group_id            = local.database_sg_id
  referenced_security_group_id = aws_security_group.ecs.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_lb" "api" {
  name                       = "${local.name}-api-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_deletion_protection = var.environment == "prod"
  tags                       = local.common_tags
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api-tg"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    path                = "/actuator/health/readiness"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30
  tags                 = local.common_tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = "${aws_ecr_repository.backend.repository_url}:${var.initial_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8080, hostPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "SPRING_PROFILES_ACTIVE", value = var.spring_profile },
      { name = "DB_URL", value = local.database_url },
      { name = "DB_USER", value = "petc_${var.environment}_app" },
      { name = "S3_BUCKET", value = aws_s3_bucket.photos.bucket },
      { name = "S3_REGION", value = var.aws_region },
      { name = "GOV_MOCK", value = tostring(var.government_mock) },
      { name = "GOV_REQUIRE_LIVE", value = tostring(var.government_require_live) },
      { name = "LTMS_MODE", value = var.ltms_mode },
      { name = "LTMS_OUTBOUND_ENABLED", value = tostring(var.ltms_outbound_enabled) },
      { name = "LTMS_UPLOAD_ENABLED", value = tostring(var.ltms_upload_enabled) },
      { name = "DEV_CENTER_KEY_ENABLED", value = "false" },
      { name = "JAVA_TOOL_OPTIONS", value = "-XX:MaxRAMPercentage=75.0" },
    ]
    secrets = [
      { name = "DB_PASS", valueFrom = aws_secretsmanager_secret.database_password.arn },
      { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${local.name}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = "db-bootstrap"
    image     = "public.ecr.aws/docker/library/postgres:18-alpine"
    essential = true
    environment = [
      { name = "DB_HOST", value = local.database_endpoint },
      { name = "DB_PORT", value = tostring(local.database_port) },
      { name = "MASTER_USERNAME", value = local.master_username },
      { name = "APP_USERNAME", value = "petc_${var.environment}_app" },
      { name = "APP_DB", value = var.application_database_name },
    ]
    secrets = [
      { name = "MASTER_PASSWORD", valueFrom = "${local.master_secret_arn}:password::" },
      { name = "APP_PASSWORD", valueFrom = aws_secretsmanager_secret.database_password.arn },
    ]
    command = [
      "/bin/sh",
      "-ec",
      <<-EOT
        export PGPASSWORD="$MASTER_PASSWORD"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$MASTER_USERNAME" -d postgres -v ON_ERROR_STOP=1 -v role="$APP_USERNAME" -v pass="$APP_PASSWORD" -v db="$APP_DB" <<'SQL'
        SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pass')
        WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
        SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pass') \gexec
        SELECT format('CREATE DATABASE %I', :'db')
        WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
        SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'db', :'role') \gexec
        SQL
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$MASTER_USERNAME" -d "$APP_DB" -v ON_ERROR_STOP=1 -v role="$APP_USERNAME" <<'SQL'
        SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'role') \gexec
        SQL
      EOT
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.db_bootstrap.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])

  tags = local.common_tags
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.bootstrap_mode ? 0 : var.service_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 180
  enable_execute_command             = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = false
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.https]
  lifecycle { ignore_changes = [task_definition] }
  tags = local.common_tags
}

resource "aws_appautoscaling_target" "ecs" {
  count = var.bootstrap_mode ? 0 : 1

  max_capacity       = var.environment == "prod" ? 6 : 2
  min_capacity       = var.service_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  count = var.bootstrap_mode ? 0 : 1

  name               = "${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
