"""
Lambda auth - Authentification dashboard
POST /auth/login → vérifie les credentials, retourne un token signé HMAC (30 jours)
"""

import os, json, hmac, hashlib, base64, time

USERNAME = os.environ.get("DASHBOARD_USERNAME", "")
PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
SECRET   = os.environ.get("DASHBOARD_TOKEN_SECRET", "")
TTL      = 30 * 24 * 3600  # 30 jours

def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()

def _make_token() -> str:
    exp = int(time.time()) + TTL
    payload = base64.b64encode(f"{USERNAME}:{exp}".encode()).decode()
    return f"{payload}.{_sign(payload)}"

def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body),
    }

def lambda_handler(event, context):
    method = (event.get("requestContext") or {}).get("http", {}).get("method", "")

    if method == "OPTIONS":
        return response(200, {})

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return response(400, {"error": "JSON invalide"})

    if body.get("username") == USERNAME and body.get("password") == PASSWORD:
        return response(200, {"token": _make_token()})

    return response(401, {"error": "Identifiants incorrects"})
