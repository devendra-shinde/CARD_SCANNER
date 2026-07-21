"""Shared dependencies for the CardVault backend.

Holds a single MongoDB client, common helpers (datetime, doc serialization,
tag normalisation, template variable rendering) and constants used across the
route modules under `routes/`. Keeping this small avoids the circular imports
that the previous monolithic `server.py` used to hide.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ────────────────────────────  DB  ────────────────────────────
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
_client = AsyncIOMotorClient(MONGO_URL)
db = _client[DB_NAME]


def close_db() -> None:
    _client.close()


# ─────────────────────────  Logging  ──────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("cardvault")

# ──────────────────────  Auth provider  ───────────────────────
EMERGENT_SESSION_URL = (
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)

# ──────────────────  Template placeholders  ──────────────────
RESERVED_VARS: List[str] = [
    "ContactName", "CompanyName", "Designation", "City", "Industry",
]


# ──────────────────────  Helpers  ─────────────────────────────
def now() -> datetime:
    # Naive UTC — MongoDB stores tz-naive; keeps comparisons consistent.
    return datetime.utcnow()


def iso(dt: datetime) -> str:
    return dt.isoformat()


def clean_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Remove _id and coerce datetimes to ISO strings (in-place-safe)."""
    if not doc:
        return doc
    doc.pop("_id", None)
    for k, v in list(doc.items()):
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


def normalize_tags(tags: list | None) -> List[str]:
    """Lower-case + strip + de-dupe (preserves order)."""
    if not tags:
        return []
    seen: set = set()
    out: List[str] = []
    for t in tags:
        if not t:
            continue
        norm = str(t).strip().lower()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out


def render_vars(text: str, contact: Dict[str, Any]) -> str:
    """Replace {{Var}} / {Var} / legacy {name} placeholders with contact fields."""
    if not text:
        return text
    m = {
        "ContactName": contact.get("name") or "",
        "CompanyName": contact.get("company") or "",
        "Designation": contact.get("designation") or "",
        "City": contact.get("city") or "",
        "Industry": contact.get("industry") or "",
    }
    for k, v in m.items():
        text = text.replace("{{" + k + "}}", str(v))
        text = text.replace("{" + k + "}", str(v))
    text = text.replace("{name}", m["ContactName"])  # legacy
    return text
