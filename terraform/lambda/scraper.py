"""
Lambda scraper - Suivi machines à laver eeproperty
Déclenché toutes les 5 min par EventBridge.
"""

import os
import json
import requests
from typing import Optional, List
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from decimal import Decimal

# ---------------------------------------------------------------------------
# Config (variables d'environnement Lambda)
# ---------------------------------------------------------------------------
LOGIN_URL    = os.environ.get("LOGIN_URL") or "https://login.eeproperty.com/"
SITE_URL     = os.environ.get("SITE_URL",   "https://vesta.eeproperty.com/machine/tenant")
USERNAME     = os.environ.get("SITE_USERNAME", "")
PASSWORD     = os.environ.get("SITE_PASSWORD", "")  # pin
TABLE_STATES = os.environ.get("DYNAMO_TABLE_STATES", "washing-tracker-states")
TABLE_CYCLES = os.environ.get("DYNAMO_TABLE_CYCLES", "washing-tracker-cycles")

# ---------------------------------------------------------------------------
# DynamoDB — init lazy (uniquement sur Lambda, pas en test local)
# ---------------------------------------------------------------------------
_states_table = None
_cycles_table = None

def _get_tables():
    global _states_table, _cycles_table
    if _states_table is None:
        import boto3
        region = os.environ.get("AWS_REGION", "eu-west-3")
        db = boto3.resource("dynamodb", region_name=region)
        _states_table = db.Table(TABLE_STATES)
        _cycles_table = db.Table(TABLE_CYCLES)
    return _states_table, _cycles_table

# ---------------------------------------------------------------------------
# 1. Authentification
# ---------------------------------------------------------------------------

def get_session() -> requests.Session:
    """
    eeproperty — authentification via formulaire HTML.
    Passe DEBUG_LOGIN=1 pour afficher tous les détails du handshake.
    """
    debug = os.environ.get("DEBUG_LOGIN", "0") == "1"
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer":    "https://login.eeproperty.com/",
        "Origin":     "https://login.eeproperty.com",
        "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })

    # GET page de login pour récupérer le CSRF token
    r = session.get(LOGIN_URL, timeout=15, allow_redirects=True)
    if debug:
        print(f"[DEBUG] GET {LOGIN_URL} → {r.status_code} (url finale: {r.url})")
        print(f"[DEBUG] HTML (500 chars):\n{r.text[:500]}")
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")

    # Collecte tous les champs cachés (CSRF, _token, etc.)
    hidden_fields = {}
    form = soup.find("form")
    if form:
        if debug:
            print(f"[DEBUG] Form action={form.get('action')} method={form.get('method')}")
            for inp in form.find_all("input"):
                print(f"[DEBUG]   <input name={inp.get('name')!r} type={inp.get('type')!r} value={str(inp.get('value',''))[:40]!r}>")
        for inp in form.find_all("input", type="hidden"):
            if inp.get("name"):
                hidden_fields[inp["name"]] = inp.get("value", "")
    elif debug:
        print("[DEBUG] Aucun <form> trouvé dans la page de login")

    payload = {
        **hidden_fields,
        "code": USERNAME,
        "pin":  PASSWORD,   # champ "pin"  = mot de passe
    }

    action = form.get("action", LOGIN_URL) if form else LOGIN_URL
    if action.startswith("/"):
        action = "https://login.eeproperty.com" + action

    if debug:
        print(f"[DEBUG] POST {action} avec payload keys={list(payload.keys())}")

    r2 = session.post(action, data=payload, timeout=15, allow_redirects=True)
    if debug:
        print(f"[DEBUG] POST → {r2.status_code}, url finale: {r2.url}")
        print(f"[DEBUG] HTML post-login (500 chars):\n{r2.text[:500]}")
    r2.raise_for_status()

    if "login" in r2.url.lower() and "machine" not in r2.url.lower():
        raise RuntimeError(f"Login échoué, URL finale : {r2.url}")

    return session


# ---------------------------------------------------------------------------
# 2. Parsing du HTML
# ---------------------------------------------------------------------------

def parse_machines(html: str) -> List[dict]:
    """
    Parse la page https://vesta.eeproperty.com/machine/tenant

    Structure HTML ciblée :
      <div class="row machine">
        <div class="col-xs-6">
          <div class="machine-label">
            <div class="machine-name">Lave-linge 1</div>
            <div>Buanderie 1</div>         ← localisation
          </div>
        </div>
        <div class="col-xs-3 machine-state">
          <i class="fas fa-circle fa-stack-2x success|danger|warning"></i>
          <label>Disponible | En cours | ...</label>
        </div>
      </div>

    Retourne :
      [
        {
          "machine_id": "lave_linge_1_buanderie_1",
          "name":       "Lave-linge 1",
          "location":   "Buanderie 1",
          "status":     "available" | "in_use",
          "status_label": "Disponible" | "En cours",
        },
        ...
      ]
    """
    soup = BeautifulSoup(html, "html.parser")
    machines = []

    for machine_div in soup.select("div.row.machine"):
        # --- Nom + localisation ---
        label_block = machine_div.select_one(".machine-label")
        if not label_block:
            continue

        name = label_block.select_one(".machine-name")
        name = name.get_text(strip=True) if name else "inconnu"

        # Le div frère de .machine-name contient la localisation
        col = label_block.select_one(".col-xs-12") or label_block
        all_divs = col.find_all("div", recursive=False)
        location = all_divs[1].get_text(strip=True) if len(all_divs) > 1 else ""

        # --- État ---
        state_block = machine_div.select_one(".machine-state")
        if not state_block:
            continue

        state_label = state_block.select_one("label")
        state_label = state_label.get_text(strip=True) if state_label else ""

        # L'icône Font Awesome porte la couleur : success = dispo, danger = occupé
        icon = state_block.select_one("i.fa-stack-2x")
        icon_classes = icon.get("class", []) if icon else []

        if "success" in icon_classes:
            status = "available"
        elif "danger" in icon_classes:
            status = "in_use"
        elif "warning" in icon_classes:
            status = "in_use"   # "réservé" = traité comme occupé
        else:
            # Fallback sur le texte du label
            txt = state_label.lower()
            if any(w in txt for w in ["disponible", "libre", "free"]):
                status = "available"
            else:
                status = "in_use"

        machine_id = (
            f"{name}_{location}"
            .lower()
            .replace(" ", "_")
            .replace("-", "_")
        )

        print(f"[parse] {machine_id} | classes={icon_classes} label={state_label!r} → {status}")

        machines.append({
            "machine_id":   machine_id,
            "name":         name,
            "location":     location,
            "status":       status,
            "status_label": state_label,
        })

    return machines


def fetch_machines() -> List[dict]:
    session = get_session()
    r = session.get(SITE_URL, timeout=15)
    r.raise_for_status()
    return parse_machines(r.text)


# ---------------------------------------------------------------------------
# 3. DynamoDB — état précédent
# ---------------------------------------------------------------------------

def get_previous_state(machine_id: str) -> Optional[dict]:
    states_table, _ = _get_tables()
    resp = states_table.get_item(Key={"machine_id": machine_id})
    return resp.get("Item")


# ---------------------------------------------------------------------------
# 4. Détection de transitions et écriture des cycles
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def handle_transition(machine: dict, prev: Optional[dict]):
    """
    Compare l'état actuel à l'état précédent et agit en conséquence.

    available → in_use  : début de cycle
    in_use    → available : fin de cycle → enregistre le cycle dans TABLE_CYCLES
    """
    states_table, cycles_table = _get_tables()
    machine_id = machine["machine_id"]
    new_status  = machine["status"]
    ts          = now_iso()
    prev_status = prev["status"] if prev else "available"

    if prev_status == new_status:
        return  # pas de changement, rien à faire

    if new_status == "in_use":
        # Début de cycle
        states_table.put_item(Item={
            "machine_id":      machine_id,
            "name":            machine["name"],
            "location":        machine["location"],
            "status":          "in_use",
            "last_changed_at": ts,
            "cycle_start_at":  ts,
        })
        print(f"[{machine_id}] Cycle démarré à {ts}")

    elif new_status == "available" and prev and prev.get("cycle_start_at"):
        # Fin de cycle — calcul de la durée
        start    = prev["cycle_start_at"]
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt   = datetime.now(timezone.utc)
        duration = int((end_dt - start_dt).total_seconds() / 60)

        date_str = end_dt.strftime("%Y-%m-%d")

        cycles_table.put_item(Item={
            # Clés
            "machine_id":        machine_id,         # PK
            "start_at":          start,              # SK
            # Données
            "end_at":            ts,
            "duration_minutes":  Decimal(str(duration)),
            "name":              machine["name"],
            "location":          machine["location"],
            # Index & stats
            "date":              date_str,
            "hour_of_day":       Decimal(str(start_dt.hour)),
            "day_of_week":       Decimal(str(start_dt.weekday())),  # 0=lundi
            "week":              start_dt.strftime("%Y-W%V"),
            "month":             start_dt.strftime("%Y-%m"),
        })

        # Réinitialise l'état courant
        states_table.put_item(Item={
            "machine_id":      machine_id,
            "name":            machine["name"],
            "location":        machine["location"],
            "status":          "available",
            "last_changed_at": ts,
            "cycle_start_at":  None,
        })

        print(f"[{machine_id}] Cycle terminé : {duration} min ({start} → {ts})")

    else:
        # Mise à jour de l'état sans cycle détecté (ex: premier démarrage)
        states_table.put_item(Item={
            "machine_id":      machine_id,
            "name":            machine["name"],
            "location":        machine["location"],
            "status":          new_status,
            "last_changed_at": ts,
            "cycle_start_at":  ts if new_status == "in_use" else None,
        })


# ---------------------------------------------------------------------------
# 5. Handler Lambda
# ---------------------------------------------------------------------------

def lambda_handler(event, context):
    try:
        machines = fetch_machines()
    except Exception as e:
        print(f"Erreur scraping : {e}")
        raise

    print(f"Machines détectées : {[m['machine_id'] for m in machines]}")

    for machine in machines:
        prev = get_previous_state(machine["machine_id"])
        handle_transition(machine, prev)

    return {
        "statusCode": 200,
        "body": json.dumps([
            {"machine_id": m["machine_id"], "status": m["status"]}
            for m in machines
        ]),
    }


# ---------------------------------------------------------------------------
# Test local (python scraper.py)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    # Simule le fetch sans DynamoDB
    print("=== Test local : fetch + parse ===")
    try:
        machines = fetch_machines()
        print(json.dumps(machines, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Erreur : {e}", file=sys.stderr)
        sys.exit(1)