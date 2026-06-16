# ============================================================================
# Terraform — Washing Machine Tracker
# Déploie : Lambda scraper, Lambda API, DynamoDB x2, API Gateway,
#            S3 (dashboard), CloudFront, IAM, EventBridge
# ============================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "aws_region"     { default = "eu-central-1" }  # Frankfurt
variable "project"        { default = "washing-tracker" }
variable "site_url"       { description = "URL du site local de suivi (ex: http://192.168.1.50/laundry)" }
variable "login_url"      { default = "" }
variable "site_username"  { description = "Login du site" }
variable "site_password"  {
  description = "Mot de passe du site"
  sensitive   = true
}

variable "dashboard_username"     { description = "Identifiant du dashboard" }
variable "dashboard_password" {
  description = "Mot de passe du dashboard"
  sensitive   = true
}
variable "dashboard_token_secret" {
  description = "Clé HMAC pour signer les tokens (openssl rand -hex 32)"
  sensitive   = true
}

# ─── DynamoDB : table des états courants ──────────────────────────────────────

resource "aws_dynamodb_table" "states" {
  name         = "${var.project}-states"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "machine_id"

  attribute {
    name = "machine_id"
    type = "S"
  }

  tags = { Project = var.project }
}

# ─── DynamoDB : table des cycles ──────────────────────────────────────────────

resource "aws_dynamodb_table" "cycles" {
  name         = "${var.project}-cycles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "machine_id"
  range_key    = "start_at"

  attribute {
    name = "machine_id"
    type = "S"
  }
  attribute {
    name = "start_at"
    type = "S"
  }
  attribute {
    name = "date"
    type = "S"
  }

  # GSI pour requêter tous les cycles d'un jour (toutes machines)
  global_secondary_index {
    name               = "date-index"
    hash_key           = "date"
    range_key          = "start_at"
    projection_type    = "ALL"
  }

  tags = { Project = var.project }
}

# ─── IAM : rôle commun aux deux Lambdas ───────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "dynamo" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan"]
    resources = [
      aws_dynamodb_table.states.arn,
      aws_dynamodb_table.cycles.arn,
      "${aws_dynamodb_table.cycles.arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "dynamo" {
  name   = "dynamo-access"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.dynamo.json
}

# ─── Lambda : scraper ─────────────────────────────────────────────────────────

data "archive_file" "scraper" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/scraper.zip"
}

resource "aws_lambda_function" "scraper" {
  function_name    = "${var.project}-scraper"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "scraper.lambda_handler"
  filename         = data.archive_file.scraper.output_path
  source_code_hash = data.archive_file.scraper.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      SITE_URL             = var.site_url
      LOGIN_URL            = var.login_url
      SITE_USERNAME        = var.site_username
      SITE_PASSWORD        = var.site_password
      DYNAMO_TABLE_STATES  = aws_dynamodb_table.states.name
      DYNAMO_TABLE_CYCLES  = aws_dynamodb_table.cycles.name
    }
  }

  layers = [aws_lambda_layer_version.requests_bs4.arn]

  tags = { Project = var.project }
}

# Layer Python avec requests + beautifulsoup4
# (buildé séparément — voir README)
resource "aws_lambda_layer_version" "requests_bs4" {
  layer_name          = "${var.project}-deps"
  filename            = "${path.module}/.build/layer.zip"
  compatible_runtimes = ["python3.12"]
  description         = "requests + beautifulsoup4 + lxml"
}

# EventBridge : toutes les 5 minutes
resource "aws_cloudwatch_event_rule" "every_5min" {
  name                = "${var.project}-every-5min"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "scraper" {
  rule      = aws_cloudwatch_event_rule.every_5min.name
  target_id = "scraper"
  arn       = aws_lambda_function.scraper.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scraper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_5min.arn
}

# ─── Lambda : API ─────────────────────────────────────────────────────────────

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/api.zip"
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project}-api"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "api.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10

  environment {
    variables = {
      DYNAMO_TABLE_STATES    = aws_dynamodb_table.states.name
      DYNAMO_TABLE_CYCLES    = aws_dynamodb_table.cycles.name
      DASHBOARD_TOKEN_SECRET = var.dashboard_token_secret
    }
  }

  tags = { Project = var.project }
}

# ─── Lambda : auth ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "auth" {
  function_name    = "${var.project}-auth"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "auth.lambda_handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10

  environment {
    variables = {
      DASHBOARD_USERNAME     = var.dashboard_username
      DASHBOARD_PASSWORD     = var.dashboard_password
      DASHBOARD_TOKEN_SECRET = var.dashboard_token_secret
    }
  }

  tags = { Project = var.project }
}

resource "aws_lambda_permission" "apigw_auth" {
  statement_id  = "AllowAPIGWAuth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── API Gateway (HTTP API — plus simple et moins cher que REST) ───────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "cycles" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /cycles"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_apigatewayv2_route" "states" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /states"
  target    = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
}

resource "aws_apigatewayv2_integration" "auth_lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_login" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.auth_lambda.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── S3 : dashboard statique ──────────────────────────────────────────────────

resource "aws_s3_bucket" "dashboard" {
  bucket = "${var.project}-dashboard-${data.aws_caller_identity.current.account_id}"
  tags   = { Project = var.project }
}

resource "aws_s3_bucket_public_access_block" "dashboard" {
  bucket                  = aws_s3_bucket.dashboard.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_caller_identity" "current" {}

# ─── CloudFront ───────────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "dashboard" {
  name                              = "${var.project}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "dashboard" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"  # EU + US uniquement

  origin {
    domain_name              = aws_s3_bucket.dashboard.bucket_regional_domain_name
    origin_id                = "s3-dashboard"
    origin_access_control_id = aws_cloudfront_origin_access_control.dashboard.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-dashboard"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    # SPA : retourner index.html pour toutes les routes
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  # Erreurs 403/404 → index.html (React Router)
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Project = var.project }
}

resource "aws_cloudfront_function" "spa_router" {
  name    = "${var.project}-spa-router"
  runtime = "cloudfront-js-2.0"
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (!uri.includes('.')) {
        request.uri = '/index.html';
      }
      return request;
    }
  EOF
}

# Politique S3 pour CloudFront OAC
data "aws_iam_policy_document" "s3_cloudfront" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.dashboard.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.dashboard.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  policy = data.aws_iam_policy_document.s3_cloudfront.json
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "api_endpoint" {
  value = aws_apigatewayv2_api.main.api_endpoint
}

output "dashboard_url" {
  value = "https://${aws_cloudfront_distribution.dashboard.domain_name}"
}

output "s3_bucket" {
  value = aws_s3_bucket.dashboard.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.dashboard.id
}
