# Washing Machine Tracker

[![CodeQL](https://github.com/fbettocchi/washing_machine/actions/workflows/codeql.yml/badge.svg)](https://github.com/fbettocchi/washing_machine/actions/workflows/codeql.yml)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![AWS](https://img.shields.io/badge/AWS-Lambda%20%2B%20DynamoDB-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com)
[![IaC](https://img.shields.io/badge/IaC-OpenTofu-7B3F9E?logo=opentofu&logoColor=white)](https://opentofu.org)

Real-time availability tracking for a residential laundry room, with cycle history and usage statistics.

## Architecture

```
EventBridge (every 5 min)
    └─▶ Lambda scraper ──▶ eeproperty.com (HTML scraping)
              │
              ▼
         DynamoDB
        ┌────────────────┐
        │ states (current│
        │ machine state) │
        │ cycles (full   │
        │ history)       │
        └────────────────┘
              │
              ▼
      Lambda API + Lambda auth
              │
              ▼
      API Gateway (HTTP)
              │
              ▼
   React/Vite ──▶ S3 ──▶ CloudFront
```

## Stack

| Component | Technology |
|---|---|
| Scraping | Python 3.12, requests, BeautifulSoup |
| Database | DynamoDB (PAY_PER_REQUEST) |
| API | Python 3.12, API Gateway HTTP |
| Auth | HMAC-SHA256, 30-day tokens |
| Frontend | React 18, Vite, Recharts |
| CDN | CloudFront + S3 |
| IaC | OpenTofu |
| Scheduling | EventBridge (every 5 minutes) |

## Prerequisites

- [OpenTofu](https://opentofu.org/) >= 1.5
- [Node.js](https://nodejs.org/) >= 18
- [AWS CLI](https://aws.amazon.com/cli/) configured (`aws configure`)
- Python 3.12 (to build the Lambda layer)

## Setup

### 1. Configure Terraform variables

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Fill in terraform/terraform.tfvars with your credentials
```

Generate the HMAC secret for tokens:
```bash
openssl rand -hex 32
```

### 2. Build the Python layer

```bash
mkdir -p /tmp/wt-layer/python terraform/.build
pip install requests beautifulsoup4 lxml -t /tmp/wt-layer/python/
cd /tmp/wt-layer && zip -r - python/ > "$OLDPWD/terraform/.build/layer.zip"
rm -rf /tmp/wt-layer
```

### 3. Deploy the infrastructure

```bash
cd terraform
tofu init
tofu apply
```

### 4. Install frontend dependencies and deploy

```bash
npm install --prefix frontend
./deploy.sh
```

## Development

```bash
# Run the frontend locally (pointing to the deployed API)
cd frontend
VITE_API_URL=https://<api-id>.execute-api.eu-central-1.amazonaws.com npm run dev
```

## Deployment

After any code change:

```bash
# Lambdas only
cd terraform && tofu apply

# Dashboard only
./deploy.sh

# Both
cd terraform && tofu apply && cd .. && ./deploy.sh
```

## Project structure

```
├── deploy.sh                  # Build + S3 upload + CloudFront invalidation
├── frontend/
│   ├── App.jsx                # React dashboard (calendar, stats)
│   ├── main.jsx               # React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── terraform/
    ├── main.tf                # All AWS infrastructure
    ├── terraform.tfvars.example
    └── lambda/
        ├── scraper.py         # eeproperty scraping + DynamoDB writes
        ├── api.py             # REST API + token verification
        └── auth.py            # Login + HMAC token generation
```
