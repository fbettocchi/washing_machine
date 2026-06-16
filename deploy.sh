#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Récupération des outputs Terraform…"
API_ENDPOINT=$(cd terraform && tofu output -raw api_endpoint)
S3_BUCKET=$(cd terraform && tofu output -raw s3_bucket)
CF_ID=$(cd terraform && tofu output -raw cloudfront_distribution_id)
CF_URL=$(cd terraform && tofu output -raw dashboard_url)

echo "  API : $API_ENDPOINT"
echo "  S3  : s3://$S3_BUCKET"
echo "  CF  : $CF_URL"

echo "→ Build Vite…"
VITE_API_URL="$API_ENDPOINT" npm run build --prefix frontend

echo "→ Upload vers S3…"
aws s3 sync frontend/dist/ "s3://$S3_BUCKET/" --delete --region eu-central-1

echo "→ Invalidation CloudFront…"
aws cloudfront create-invalidation --distribution-id "$CF_ID" --paths "/*" > /dev/null

echo "✓ Dashboard en ligne : $CF_URL"
