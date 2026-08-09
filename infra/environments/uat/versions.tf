terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region  = "ap-southeast-1"
  profile = var.aws_profile
  default_tags { tags = { Project = "petc", Environment = "uat", ManagedBy = "terraform" } }
}

provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
  default_tags { tags = { Project = "petc", Environment = "uat", ManagedBy = "terraform" } }
}
