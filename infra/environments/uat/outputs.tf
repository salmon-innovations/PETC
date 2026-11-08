output "deployment" {
  value = {
    github_deploy_role_arn     = module.petc.github_deploy_role_arn
    ecr_repository_name        = module.petc.ecr_repository_name
    ecs_cluster_name           = module.petc.ecs_cluster_name
    ecs_service_name           = module.petc.ecs_service_name
    ecs_task_family            = module.petc.ecs_task_family
    db_bootstrap_task_family   = module.petc.db_bootstrap_task_family
    ecs_private_subnet_ids     = module.petc.ecs_private_subnet_ids
    ecs_security_group_id      = module.petc.ecs_security_group_id
    frontend_bucket_name       = module.petc.frontend_bucket_name
    release_bucket_name        = module.petc.release_bucket_name
    cloudfront_distribution_id = module.petc.cloudfront_distribution_id
    frontend_url               = module.petc.frontend_url
    api_url                    = module.petc.api_url
    desktop_update_url         = module.petc.desktop_update_url
    alarm_topic_arn            = module.petc.alarm_topic_arn
  }
}
