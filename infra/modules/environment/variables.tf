variable "environment" {
  type        = string
  description = "Deployment environment: uat or prod."

  validation {
    condition     = contains(["uat", "prod"], var.environment)
    error_message = "environment must be uat or prod"
  }
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }

variable "frontend_domain" { type = string }
variable "api_domain" { type = string }
variable "route53_zone_name" {
  type    = string
  default = "siiportal.com"
}

variable "github_branch" { type = string }
variable "github_environment_name" { type = string }
variable "github_repository" {
  type    = string
  default = "salmon-innovations/PETC"
}

variable "spring_profile" {
  type    = string
  default = "production"
}

variable "government_mock" {
  type    = bool
  default = true
}

variable "government_require_live" {
  type    = bool
  default = false
}

variable "ltms_mode" {
  type        = string
  default     = "mock"
  description = "LTMS client mode. This does not enable network traffic by itself."

  validation {
    condition     = contains(["mock", "production"], var.ltms_mode)
    error_message = "ltms_mode must be mock or production"
  }
}

variable "ltms_outbound_enabled" {
  type        = bool
  default     = false
  description = "Explicit gate for any outbound LTMS request."
}

variable "ltms_upload_enabled" {
  type        = bool
  default     = false
  description = "Independent gate for mutating LTMS CEC upload and replacement calls."
}

variable "ltms_production_upload_enabled" {
  type        = bool
  default     = false
  description = "Additional disabled-by-default deployment gate for production LTMS CEC mutations."
}

variable "ltms_commissioning_approved" {
  type        = bool
  default     = false
  description = "Explicit approval required before any production LTMS egress."
}

variable "ltms_allowed_hosts" {
  type        = list(string)
  default     = []
  description = "Exact HTTPS LTMS hosts permitted for outbound requests."
}

variable "ltms_petc_base_url" {
  type        = string
  default     = ""
  description = "Production PETC v2 base URL, including /ords/dl_interfaces when supplied by LTMS."
}

variable "ltms_jwt_base_url" {
  type        = string
  default     = ""
  description = "Production JWT service origin/base URL supplied by LTMS."
}

variable "service_desired_count" {
  type    = number
  default = 1
}

variable "bootstrap_mode" {
  type        = bool
  default     = false
  description = "Creates the ECS service at zero tasks until the first image and database bootstrap are ready."
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "initial_image_tag" {
  type        = string
  default     = "latest"
  description = "An image with this tag must exist before the ECS service reaches its desired count."
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "object_retention_days" {
  type    = number
  default = 1095
}

variable "create_rds" {
  type    = bool
  default = false
}

variable "existing_rds_endpoint" {
  type    = string
  default = null
}

variable "existing_rds_security_group_id" {
  type    = string
  default = null
}

variable "existing_rds_master_secret_arn" {
  type      = string
  default   = null
  sensitive = true
}

variable "existing_rds_master_username" {
  type    = string
  default = "postgres"
}

variable "application_database_name" { type = string }

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "rds_engine_version" {
  type    = string
  default = "18.3"
}

variable "rds_multi_az" {
  type    = bool
  default = true
}

variable "rds_deletion_protection" {
  type    = bool
  default = true
}

variable "enable_long_term_rds_backup" {
  type    = bool
  default = false
}
