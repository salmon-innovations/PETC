resource "aws_s3_bucket" "frontend" {
  bucket = local.frontend_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket" "photos" {
  bucket = local.photo_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket" "releases" {
  bucket = local.release_bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "all" {
  for_each = {
    frontend = aws_s3_bucket.frontend.id
    photos   = aws_s3_bucket.photos.id
    releases = aws_s3_bucket.releases.id
  }

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "all" {
  for_each = {
    frontend = aws_s3_bucket.frontend.id
    photos   = aws_s3_bucket.photos.id
    releases = aws_s3_bucket.releases.id
  }

  bucket = each.value
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "all" {
  for_each = {
    frontend = aws_s3_bucket.frontend.id
    photos   = aws_s3_bucket.photos.id
    releases = aws_s3_bucket.releases.id
  }

  bucket = each.value
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "all" {
  for_each = {
    frontend = aws_s3_bucket.frontend.id
    photos   = aws_s3_bucket.photos.id
    releases = aws_s3_bucket.releases.id
  }

  bucket = each.value
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "frontend" {
  bucket     = aws_s3_bucket.frontend.id
  depends_on = [aws_s3_bucket_versioning.all]

  rule {
    id     = "expire-old-frontend-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket     = aws_s3_bucket.photos.id
  depends_on = [aws_s3_bucket_versioning.all]

  rule {
    id     = "three-year-retention"
    status = "Enabled"
    filter {}
    expiration { days = var.object_retention_days }
    noncurrent_version_expiration { noncurrent_days = var.object_retention_days }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket     = aws_s3_bucket.releases.id
  depends_on = [aws_s3_bucket_versioning.all]

  rule {
    id     = "three-year-retention"
    status = "Enabled"
    filter {}
    expiration { days = var.object_retention_days }
    noncurrent_version_expiration { noncurrent_days = var.object_retention_days }
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = data.aws_route_tables.private.ids
  tags              = merge(local.common_tags, { Name = "${local.name}-s3-endpoint" })
}

data "aws_route_tables" "private" {
  vpc_id = var.vpc_id

  filter {
    name   = "association.subnet-id"
    values = var.private_subnet_ids
  }
}
