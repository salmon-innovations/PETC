output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
output "ecr_repository_name" { value = aws_ecr_repository.backend.name }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "ecs_cluster_name" { value = aws_ecs_cluster.main.name }
output "ecs_service_name" { value = aws_ecs_service.api.name }
output "ecs_task_family" { value = aws_ecs_task_definition.api.family }
output "db_bootstrap_task_family" { value = aws_ecs_task_definition.db_bootstrap.family }
output "ecs_private_subnet_ids" { value = var.private_subnet_ids }
output "ecs_security_group_id" { value = aws_security_group.ecs.id }
output "frontend_bucket_name" { value = aws_s3_bucket.frontend.bucket }
output "photo_bucket_name" { value = aws_s3_bucket.photos.bucket }
output "release_bucket_name" { value = aws_s3_bucket.releases.bucket }
output "cloudfront_distribution_id" { value = aws_cloudfront_distribution.frontend.id }
output "api_url" { value = "https://${var.api_domain}" }
output "frontend_url" { value = "https://${var.frontend_domain}" }
output "desktop_update_url" {
  value = "https://${var.frontend_domain}/downloads/desktop/${var.environment == "prod" ? "stable" : "uat"}"
}
output "alarm_topic_arn" { value = aws_sns_topic.alarms.arn }
output "database_endpoint" {
  value     = local.database_endpoint
  sensitive = true
}
