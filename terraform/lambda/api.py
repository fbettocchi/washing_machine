"""
Lambda API - Expose les données DynamoDB au dashboard
Routes :
  POST /auth/login              → délégué à la Lambda auth
  GET  /states                  → état courant des machines
  GET  /cycles?from=YYYY-MM-DD&to=YYYY-MM-DD  → cycles sur une période
  GET  /cycles?month=YYYY-MM    → cycles d'un mois via GSI
"""

import os
import json
import hmac
import hashlib
import base64
import time
import boto3
from datetime import datetime, timezone
from decimal import Decimal
from boto3.dynamodb.conditions import Key

TABLE_STATES  = os.environ.get("DYNAMO_TABLE_STATES", "washing-tracker-states")
TABLE_CYCLES  = os.environ.get("DYNAMO_TABLE_CYCLES", "washing-tracker-cycles")
TOKEN_SECRET  = os.environ.get("DASHBOARD_TOKEN_SECRET", "")

_states_table = None
_cycles_table = None

def _get_tables():
    global _states_table, _cycles_table
    if _states_table is None:
        region = os.environ.get("AWS_REGION", "eu-central-1")
        db = boto3.resource("dynamodb", region_name=region)
        _states_table = db.Table(TABLE_STATES)
        _cycles_table = db.Table(TABLE_CYCLES)
    return _states_table, _cycles_table

# ─── Auth ─────────────────────────────────────────────────────────────────────

def _verify_token(token: str) -> bool:
    if not TOKEN_SECRET:
        return True  # dev local sans secret configuré
    try:
        payload, sig = token.rsplit(".", 1)
        expected = hmac.new(TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        data = base64.b64decode(payload).decode()
        exp = int(data.rsplit(":", 1)[1])
        return time.time() < exp
    except Exception:
        return False

def _check_auth(event) -> bool:
    header = (event.get("headers") or {}).get("authorization", "")
    if not header.lower().startswith("bearer "):
        return False
    return _verify_token(header[7:])

# ─── Sérialisation ────────────────────────────────────────────────────────────

def decimal_to_native(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Type non sérialisable : {type(obj)}")

def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body, default=decimal_to_native, ensure_ascii=False),
    }

# ─── Données ──────────────────────────────────────────────────────────────────

def get_states():
    states_table, _ = _get_tables()
    return states_table.scan().get("Items", [])

def get_cycles(params):
    _, cycles_table = _get_tables()
    items = []

    if "month" in params:
        month = params["month"]
        from datetime import date
        import calendar
        year, m = int(month.split("-")[0]), int(month.split("-")[1])
        _, days_in_month = calendar.monthrange(year, m)
        for d in range(1, days_in_month + 1):
            date_str = f"{year}-{str(m).zfill(2)}-{str(d).zfill(2)}"
            resp = cycles_table.query(
                IndexName="date-index",
                KeyConditionExpression=Key("date").eq(date_str),
            )
            items.extend(resp.get("Items", []))

    elif "from" in params and "to" in params:
        from_date  = params["from"]
        to_date    = params["to"]
        machine_id = params.get("machine_id")
        if machine_id:
            resp = cycles_table.query(
                KeyConditionExpression=(
                    Key("machine_id").eq(machine_id) &
                    Key("start_at").between(from_date, to_date + "T23:59:59Z")
                )
            )
            items = resp.get("Items", [])
        else:
            from boto3.dynamodb.conditions import Attr
            resp = cycles_table.scan(
                FilterExpression=Attr("start_at").between(from_date, to_date + "T23:59:59Z")
            )
            items = resp.get("Items", [])

    else:
        from datetime import timedelta
        today = datetime.now(timezone.utc)
        for i in range(30):
            date_str = (today - timedelta(days=i)).strftime("%Y-%m-%d")
            resp = cycles_table.query(
                IndexName="date-index",
                KeyConditionExpression=Key("date").eq(date_str),
            )
            items.extend(resp.get("Items", []))

    items.sort(key=lambda x: x.get("start_at", ""), reverse=True)
    return items

# ─── Handler ──────────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    method = (event.get("requestContext") or {}).get("http", {}).get("method", "")
    path   = event.get("rawPath", "/")
    params = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return response(200, {})

    if not _check_auth(event):
        return response(401, {"error": "Non authentifié"})

    try:
        if path == "/states":
            return response(200, get_states())
        elif path == "/cycles":
            return response(200, get_cycles(params))
        else:
            return response(404, {"error": f"Route inconnue : {path}"})
    except Exception as e:
        print(f"Erreur : {e}")
        return response(500, {"error": str(e)})
