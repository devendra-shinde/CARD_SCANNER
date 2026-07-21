"""CardVault backend — Business Card OCR & Smart Contact Management."""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth_utils import (  # noqa: E402
    generate_otp,
    get_current_user_id,
    hash_password,
    make_access_token,
    verify_password,
)
from email_utils import otp_email_html, send_smtp, send_system_email  # noqa: E402
from enrich_utils import scrape_website  # noqa: E402
from ocr_utils import OcrError, scan_business_card  # noqa: E402


def _normalize_tags(tags: list[str] | None) -> list[str]:
    """Lower-case + strip + de-dupe (preserves order)."""
    if not tags:
        return []
    seen: set = set()
    out: list[str] = []
    for t in tags:
        if not t:
            continue
        norm = str(t).strip().lower()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out

# ────────────────────────────  DB  ────────────────────────────
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ─────────────────────────  Logging  ──────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("cardvault")

# ────────────────────────  App / Router  ──────────────────────
app = FastAPI(title="CardVault API", version="1.0.0")
api = APIRouter(prefix="/api")


def now() -> datetime:
    # Naive UTC — MongoDB stores tz-naive; keeps comparisons consistent.
    return datetime.utcnow()


def iso(dt: datetime) -> str:
    return dt.isoformat()


# ──────────────────────────  MODELS  ──────────────────────────
class SignupIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    organization: Optional[str] = ""
    role: Optional[str] = ""


class VerifyOtpIn(BaseModel):
    email: EmailStr
    otp: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ResendOtpIn(BaseModel):
    email: EmailStr


class ForgotPwIn(BaseModel):
    email: EmailStr


class ResetPwIn(BaseModel):
    email: EmailStr
    otp: str
    new_password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    organization: str = ""
    role: str = ""
    email_verified: bool = False
    created_at: str


class ContactIn(BaseModel):
    name: str = ""
    designation: str = ""
    company: str = ""
    email: str = ""
    phone: str = ""
    website: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    pincode: str = ""
    industry: str = ""
    tags: List[str] = []
    notes: str = ""
    linkedin: str = ""
    company_size: str = ""
    social_links: Dict[str, str] = {}
    source: str = "manual"
    image_b64: Optional[str] = None  # optional business card image
    avatar_b64: Optional[str] = None  # face crop for profile picture
    favorite: bool = False


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    designation: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    pincode: Optional[str] = None
    industry: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    linkedin: Optional[str] = None
    company_size: Optional[str] = None
    social_links: Optional[Dict[str, str]] = None
    favorite: Optional[bool] = None
    avatar_b64: Optional[str] = None


class MergeIn(BaseModel):
    primary_id: str
    duplicate_ids: List[str]


class OcrIn(BaseModel):
    image_b64: str


class EnrichIn(BaseModel):
    website: Optional[str] = ""
    company: Optional[str] = ""


class EmailConfigIn(BaseModel):
    provider: str  # "gmail" | "outlook" | "yahoo" | "custom"
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_pass: str
    from_name: str = ""
    reply_to: str = ""
    use_tls: bool = True


class TestSmtpIn(BaseModel):
    to: EmailStr


class TemplateIn(BaseModel):
    name: str
    subject: str
    body_html: str


class CampaignIn(BaseModel):
    name: str
    subject: str
    body_html: str
    recipient_ids: List[str] = []
    filter_tags: List[str] = []
    filter_industries: List[str] = []
    filter_countries: List[str] = []
    filter_states: List[str] = []
    filter_cities: List[str] = []
    # Legacy singletons kept for backward compat
    filter_tag: Optional[str] = None
    filter_industry: Optional[str] = None
    attachments: List[Dict[str, str]] = []  # [{filename, mime_type, content_b64}]
    email_account_id: Optional[str] = None


# ─────────────────────  DB serialization helpers  ─────────────
def clean_doc(doc: dict) -> dict:
    """Remove _id and coerce datetimes to ISO strings."""
    if not doc:
        return doc
    doc.pop("_id", None)
    for k, v in list(doc.items()):
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


# ────────────────────────  AUTH  ────────────────────────
async def _issue_otp(email: str, purpose: str) -> tuple[str, bool]:
    """Create + persist an OTP. Returns (otp, dev_mode).

    dev_mode is True when no system SMTP is configured — callers should surface
    the OTP in the response so the preview app still works end-to-end.
    """
    otp = generate_otp(6)
    await db.otps.delete_many({"email": email, "purpose": purpose})
    await db.otps.insert_one({
        "email": email,
        "otp": otp,
        "purpose": purpose,
        "expires_at": now() + timedelta(minutes=10),
        "created_at": now(),
    })
    logger.info("OTP for %s (%s) = %s", email, purpose, otp)
    dev_mode = not (os.environ.get("SYSTEM_SMTP_HOST", "").strip())
    if not dev_mode:
        ok, err = send_system_email(
            to=email,
            subject=f"Your CardVault {purpose} code: {otp}",
            html=otp_email_html(otp, purpose),
            text=f"Your CardVault {purpose} code: {otp}. Expires in 10 minutes.",
        )
        if not ok:
            logger.warning("system email send failed for %s: %s", email, err)
    return otp, dev_mode


@api.get("/")
async def root():
    return {"service": "cardvault", "status": "ok"}


@api.post("/auth/signup")
async def signup(body: SignupIn):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        if existing.get("email_verified"):
            raise HTTPException(400, "Email already registered")
        # Not verified — re-send OTP for signup
        otp, dev_mode = await _issue_otp(body.email.lower(), "signup")
        resp = {"message": "OTP re-sent", "email": body.email.lower()}
        if dev_mode:
            resp["dev_otp"] = otp
        return resp
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "name": body.name.strip(),
        "email": body.email.lower(),
        "password": hash_password(body.password),
        "organization": body.organization or "",
        "role": body.role or "",
        "email_verified": False,
        "created_at": now(),
        "updated_at": now(),
    }
    await db.users.insert_one(doc)
    otp, dev_mode = await _issue_otp(body.email.lower(), "signup")
    resp = {"message": "OTP sent to email", "email": body.email.lower()}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@api.post("/auth/verify-otp")
async def verify_otp(body: VerifyOtpIn):
    row = await db.otps.find_one({"email": body.email.lower(), "purpose": "signup"})
    if not row or row["otp"] != body.otp:
        raise HTTPException(400, "Invalid OTP")
    if row["expires_at"] < now():
        raise HTTPException(400, "OTP expired")
    await db.otps.delete_one({"_id": row["_id"]})
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True, "updated_at": now()}})
    token = make_access_token(user["id"])
    user["email_verified"] = True
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "organization": user.get("organization", ""),
            "role": user.get("role", ""),
            "email_verified": True,
            "created_at": iso(user["created_at"]),
        },
    }


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password"]):
        raise HTTPException(401, "Invalid credentials")
    if not user.get("email_verified"):
        otp, dev_mode = await _issue_otp(user["email"], "signup")
        detail: Any = "Email not verified. OTP re-sent."
        if dev_mode:
            # Include dev_otp in the 403 detail body so the frontend can display it.
            raise HTTPException(status_code=403, detail={"message": detail, "dev_otp": otp})
        raise HTTPException(403, detail)
    token = make_access_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "organization": user.get("organization", ""),
            "role": user.get("role", ""),
            "email_verified": True,
            "created_at": iso(user["created_at"]),
        },
    }


@api.post("/auth/resend-otp")
async def resend_otp(body: ResendOtpIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    otp, dev_mode = await _issue_otp(user["email"], "signup")
    resp: Dict[str, Any] = {"message": "OTP re-sent"}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPwIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        # do not leak; still respond ok
        return {"message": "If the email exists, a reset code has been sent."}
    otp, dev_mode = await _issue_otp(user["email"], "reset")
    resp: Dict[str, Any] = {"message": "Reset code sent"}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@api.post("/auth/reset-password")
async def reset_password(body: ResetPwIn):
    row = await db.otps.find_one({"email": body.email.lower(), "purpose": "reset"})
    if not row or row["otp"] != body.otp:
        raise HTTPException(400, "Invalid OTP")
    if row["expires_at"] < now():
        raise HTTPException(400, "OTP expired")
    await db.otps.delete_one({"_id": row["_id"]})
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password": hash_password(body.new_password), "updated_at": now()}},
    )
    return {"message": "Password reset successfully"}


@api.get("/auth/me")
async def me(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(404, "User not found")
    for k in ("created_at", "updated_at"):
        if isinstance(user.get(k), datetime):
            user[k] = iso(user[k])
    return user


# ─────────────────────────  CONTACTS  ──────────────────────────
@api.post("/contacts")
async def create_contact(body: ContactIn, user_id: str = Depends(get_current_user_id)):
    cid = str(uuid.uuid4())
    doc = body.model_dump()
    doc["tags"] = _normalize_tags(doc.get("tags"))
    doc.update({
        "id": cid,
        "user_id": user_id,
        "created_at": now(),
        "updated_at": now(),
    })
    await db.contacts.insert_one(doc)
    return clean_doc(dict(doc))


@api.get("/contacts")
async def list_contacts(
    user_id: str = Depends(get_current_user_id),
    search: Optional[str] = None,
    tag: Optional[str] = None,   # single-tag legacy; comma-separated also accepted
    tags: Optional[str] = None,  # comma-separated multi-select
    industry: Optional[str] = None,   # comma-separated multi-select
    company: Optional[str] = None,
    country: Optional[str] = None,    # comma-separated
    state: Optional[str] = None,      # comma-separated
    city: Optional[str] = None,       # comma-separated
    favorite: Optional[bool] = None,
    sort: str = "recent",  # recent | name | company
    limit: int = 500,
):
    q: Dict[str, Any] = {"user_id": user_id}

    def _multi(val: Optional[str]) -> Optional[list[str]]:
        if not val:
            return None
        parts = [v.strip() for v in str(val).split(",") if v.strip()]
        return parts or None

    tag_list = _multi(tags) or _multi(tag)
    if tag_list:
        # tags stored lowercase; incoming may be Title-Case
        q["tags"] = {"$in": [t.lower() for t in tag_list]}
    inds = _multi(industry)
    if inds:
        q["industry"] = {"$in": inds}
    if company:
        q["company"] = company
    countries = _multi(country)
    if countries:
        q["country"] = {"$in": countries}
    states = _multi(state)
    if states:
        q["state"] = {"$in": states}
    cities = _multi(city)
    if cities:
        q["city"] = {"$in": cities}
    if favorite is not None:
        q["favorite"] = favorite
    if search:
        rx = {"$regex": search, "$options": "i"}
        q["$or"] = [
            {"name": rx},
            {"company": rx},
            {"email": rx},
            {"phone": rx},
            {"designation": rx},
        ]
    sort_key = {"recent": ("created_at", -1), "name": ("name", 1), "company": ("company", 1)}.get(sort, ("created_at", -1))
    cur = db.contacts.find(q, {"_id": 0}).sort(*sort_key).limit(limit)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items, "count": len(items)}


@api.get("/contacts/facets")
async def list_contact_facets(user_id: str = Depends(get_current_user_id)):
    """Distinct values for filter chips (countries, states, cities, industries, tags)."""
    facets = {}
    for field in ("country", "state", "city", "industry"):
        cur = db.contacts.aggregate([
            {"$match": {"user_id": user_id, field: {"$nin": ["", None]}}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 50},
        ])
        facets[field] = [{"value": d["_id"], "count": d["count"]} async for d in cur]
    # Tags array — unwind
    cur = db.contacts.aggregate([
        {"$match": {"user_id": user_id}},
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ])
    facets["tag"] = [{"value": d["_id"], "count": d["count"]} async for d in cur if d["_id"]]
    return facets


@api.get("/contacts/duplicates")
async def find_duplicates(user_id: str = Depends(get_current_user_id)):
    """Group contacts by email/phone that appear more than once."""
    cur = db.contacts.find({"user_id": user_id}, {"_id": 0})
    by_email: Dict[str, list] = {}
    by_phone: Dict[str, list] = {}
    async for c in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(c.get(k), datetime):
                c[k] = iso(c[k])
        if c.get("email"):
            by_email.setdefault(c["email"].lower().strip(), []).append(c)
        if c.get("phone"):
            phone = "".join(ch for ch in c["phone"] if ch.isdigit())
            if len(phone) >= 7:
                by_phone.setdefault(phone[-10:], []).append(c)
    groups = []
    seen_ids: set = set()
    for group in list(by_email.values()) + list(by_phone.values()):
        if len(group) > 1:
            ids = tuple(sorted(c["id"] for c in group))
            if ids in seen_ids:
                continue
            seen_ids.add(ids)
            groups.append(group)
    return {"groups": groups}


# NOTE: this static route MUST be declared before /contacts/{contact_id} so
# FastAPI does not treat "recipient-status" as a contact id.
@api.get("/contacts/recipient-status")
async def recipient_status(user_id: str = Depends(get_current_user_id)):
    """For every contact with an email, return quota info: emails_sent_7d, remaining, last_emailed."""
    user = await db.users.find_one({"id": user_id}) or {}
    seven_days_ago = now() - timedelta(days=7)
    cur = db.contacts.find({"user_id": user_id, "email": {"$ne": ""}}, {"_id": 0})
    items = []
    async for c in cur:
        email = c["email"].lower()
        sent = await db.campaign_history.count_documents({
            "user_id": user_id, "status": "sent",
            "recipient_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
            "sent_at": {"$gte": seven_days_ago},
        })
        last = await db.campaign_history.find_one(
            {"user_id": user_id, "status": "sent",
             "recipient_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}},
            sort=[("sent_at", -1)],
        )
        items.append({
            "contact_id": c["id"],
            "email": c["email"],
            "emails_sent_7d": sent,
            "remaining_weekly": max(0, 3 - sent),
            "blocked": sent >= 3,
            "last_emailed": iso(last["sent_at"]) if last and isinstance(last.get("sent_at"), datetime) else None,
        })
    plan = get_effective_plan(user)
    today = now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_sent = await db.campaign_history.count_documents({"user_id": user_id, "status": "sent", "sent_at": {"$gte": today}})
    cap = free_daily_limit(user)
    return {
        "items": items,
        "plan": plan,
        "daily_sent": daily_sent,
        "daily_cap": cap,
        "remaining_today": None if cap is None else max(0, cap - daily_sent),
    }


@api.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.contacts.find_one({"id": contact_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Contact not found")
    for k in ("created_at", "updated_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc


@api.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user_id: str = Depends(get_current_user_id)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    if "tags" in updates:
        updates["tags"] = _normalize_tags(updates["tags"])
    updates["updated_at"] = now()
    res = await db.contacts.update_one({"id": contact_id, "user_id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Contact not found")
    doc = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    for k in ("created_at", "updated_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc


@api.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.contacts.delete_one({"id": contact_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Contact not found")
    return {"ok": True}


@api.post("/contacts/merge")
async def merge_contacts(body: MergeIn, user_id: str = Depends(get_current_user_id)):
    primary = await db.contacts.find_one({"id": body.primary_id, "user_id": user_id}, {"_id": 0})
    if not primary:
        raise HTTPException(404, "Primary contact not found")
    for did in body.duplicate_ids:
        if did == body.primary_id:
            continue
        dup = await db.contacts.find_one({"id": did, "user_id": user_id}, {"_id": 0})
        if not dup:
            continue
        # Merge non-empty fields into primary
        for k, v in dup.items():
            if k in ("id", "user_id", "created_at", "updated_at", "_id"):
                continue
            if not primary.get(k) and v:
                primary[k] = v
            elif k == "tags":
                tags = set(primary.get("tags", []) or [])
                tags.update(v or [])
                primary["tags"] = list(tags)
        await db.contacts.delete_one({"id": did, "user_id": user_id})
    primary["updated_at"] = now()
    await db.contacts.update_one({"id": body.primary_id, "user_id": user_id}, {"$set": primary})
    for k in ("created_at", "updated_at"):
        if isinstance(primary.get(k), datetime):
            primary[k] = iso(primary[k])
    return primary


# ─────────────────────────  OCR / SCAN  ─────────────────────────
@api.post("/ocr/scan")
async def ocr_scan(body: OcrIn, user_id: str = Depends(get_current_user_id)):
    try:
        data = await scan_business_card(body.image_b64)
        return data
    except OcrError as e:
        # Friendly, actionable message
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("scan failed")
        raise HTTPException(
            500,
            "OCR service is temporarily unavailable. Please add the contact manually — we'll auto-fill what we can.",
        )


# ─────────────────────────  AI EMAIL ASSIST  ─────────────────────────
class AiEmailIn(BaseModel):
    action: str  # "generate" | "rewrite" | "shorten" | "expand" | "formalize" | "friendly"
    prompt: Optional[str] = ""
    subject: Optional[str] = ""
    body: Optional[str] = ""
    tone: Optional[str] = ""  # "professional" | "friendly" | "concise" | "persuasive"


@api.post("/ai/write-email")
async def write_email(body: AiEmailIn, user_id: str = Depends(get_current_user_id)):
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        raise HTTPException(503, "AI service unavailable")
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI service not configured")

    action = (body.action or "generate").lower()
    tone = body.tone or "professional"

    if action == "generate":
        instr = (
            f"Write a {tone} outreach email (subject + body) for the following context. "
            f"Keep it under 120 words. Address the recipient as {{name}} using a placeholder."
        )
        content = f"Context / user prompt:\n{body.prompt or 'General outreach — introduce yourself and propose a quick chat.'}"
    elif action == "rewrite":
        instr = f"Rewrite the following email in a more {tone} tone. Keep meaning intact."
        content = f"Subject: {body.subject}\n\n{body.body}"
    elif action == "shorten":
        instr = "Shorten the following email to at most 60 words while keeping the ask clear."
        content = f"Subject: {body.subject}\n\n{body.body}"
    elif action == "expand":
        instr = "Expand the following email with more detail, benefits and a clear call-to-action. Under 150 words."
        content = f"Subject: {body.subject}\n\n{body.body}"
    elif action in ("formalize", "friendly"):
        target = "formal and professional" if action == "formalize" else "warm and friendly"
        instr = f"Rewrite the email in a {target} tone."
        content = f"Subject: {body.subject}\n\n{body.body}"
    else:
        raise HTTPException(400, "Unknown action")

    prompt = f"""{instr}

Return ONLY valid JSON with two keys — no code fences, no commentary:
{{
  "subject": "the email subject line",
  "body": "the email body — plain text, one blank line between paragraphs, use {{name}} for the recipient placeholder"
}}

{content}
"""
    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"aiemail-{os.urandom(4).hex()}",
                    system_message="You are an expert B2B copywriter. Return only JSON.")
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
        text = (resp or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        try:
            data = json.loads(text, strict=False)
        except json.JSONDecodeError:
            # Try to recover: extract first {...} block
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if not m:
                raise
            data = json.loads(m.group(0), strict=False)
        return {
            "subject": str(data.get("subject", "") or ""),
            "body": str(data.get("body", "") or ""),
        }
    except Exception as e:
        logger.exception("AI write email failed")
        raise HTTPException(500, f"AI generation failed: {e}")


# ─────────────────────────  ENRICHMENT  ─────────────────────────
@api.post("/enrich")
async def enrich(body: EnrichIn, user_id: str = Depends(get_current_user_id)):
    if not body.website and not body.company:
        raise HTTPException(400, "Provide website or company")
    if body.website:
        data = await scrape_website(body.website)
        return data
    return {"note": "company-only enrichment requires web search — provide a website URL."}


# ─────────────────────────  EMAIL CONFIG  ─────────────────────────
@api.get("/settings/email")
async def get_email_config(user_id: str = Depends(get_current_user_id)):
    doc = await db.email_configs.find_one({"user_id": user_id}, {"_id": 0, "smtp_pass": 0})
    return doc or {}


@api.post("/settings/email")
async def set_email_config(body: EmailConfigIn, user_id: str = Depends(get_current_user_id)):
    doc = body.model_dump()
    doc.update({"user_id": user_id, "updated_at": now()})
    await db.email_configs.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.post("/settings/email/test")
async def test_email_config(body: TestSmtpIn, user_id: str = Depends(get_current_user_id)):
    cfg = await db.email_configs.find_one({"user_id": user_id})
    if not cfg:
        raise HTTPException(400, "No email config saved")
    from_addr = cfg.get("from_name") or cfg["smtp_user"]
    ok, err = send_smtp(
        host=cfg["smtp_host"],
        port=int(cfg.get("smtp_port", 587)),
        username=cfg["smtp_user"],
        password=cfg["smtp_pass"],
        from_addr=from_addr,
        to=body.to,
        subject="CardVault test email",
        html="<p>Your CardVault SMTP configuration works ✔</p>",
        text="Your CardVault SMTP configuration works.",
        use_tls=bool(cfg.get("use_tls", True)),
    )
    if not ok:
        raise HTTPException(400, f"SMTP test failed: {err}")
    return {"ok": True}


# ─────────────────────────  TEMPLATES  ─────────────────────────
@api.get("/templates")
async def list_templates(user_id: str = Depends(get_current_user_id)):
    cur = db.templates.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@api.post("/templates")
async def create_template(body: TemplateIn, user_id: str = Depends(get_current_user_id)):
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now(), "updated_at": now()})
    await db.templates.insert_one(doc)
    return clean_doc(dict(doc))


@api.delete("/templates/{template_id}")
async def delete_template(template_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.templates.delete_one({"id": template_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return {"ok": True}


# ─────────────────────────  CAMPAIGNS  ─────────────────────────
async def _resolve_recipients(user_id: str, body: CampaignIn) -> List[dict]:
    q: Dict[str, Any] = {"user_id": user_id}

    tag_list = [t.lower() for t in (body.filter_tags or []) if t]
    if body.filter_tag and body.filter_tag.lower() not in tag_list:
        tag_list.append(body.filter_tag.lower())
    if tag_list:
        q["tags"] = {"$in": tag_list}

    inds = [i for i in (body.filter_industries or []) if i]
    if body.filter_industry and body.filter_industry not in inds:
        inds.append(body.filter_industry)
    if inds:
        q["industry"] = {"$in": inds}

    if body.filter_countries:
        q["country"] = {"$in": body.filter_countries}
    if body.filter_states:
        q["state"] = {"$in": body.filter_states}
    if body.filter_cities:
        q["city"] = {"$in": body.filter_cities}

    contacts: List[dict] = []
    if body.recipient_ids:
        q_ids = {**q, "id": {"$in": body.recipient_ids}}
        cur = db.contacts.find(q_ids, {"_id": 0})
    else:
        cur = db.contacts.find(q, {"_id": 0})
    async for c in cur:
        if c.get("email"):
            contacts.append(c)
    # dedupe by email
    dedup: Dict[str, dict] = {}
    for c in contacts:
        dedup.setdefault(c["email"].lower(), c)
    return list(dedup.values())


@api.get("/campaigns")
async def list_campaigns(user_id: str = Depends(get_current_user_id)):
    cur = db.campaigns.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at", "sent_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@api.post("/campaigns")
async def create_campaign(body: CampaignIn, user_id: str = Depends(get_current_user_id)):
    recipients = await _resolve_recipients(user_id, body)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": body.name,
        "subject": body.subject,
        "body_html": body.body_html,
        "recipient_ids": [c["id"] for c in recipients],
        "recipient_emails": [c["email"] for c in recipients],
        "recipient_count": len(recipients),
        "email_account_id": body.email_account_id,
        "attachments": body.attachments,
        "status": "draft",
        "sent_count": 0,
        "failed_count": 0,
        "opened_count": 0,
        "clicked_count": 0,
        "created_at": now(),
        "updated_at": now(),
    }
    await db.campaigns.insert_one(dict(doc))
    return clean_doc(dict(doc))


@api.post("/campaigns/{campaign_id}/send")
async def send_campaign(campaign_id: str, user_id: str = Depends(get_current_user_id)):
    campaign = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    user = await db.users.find_one({"id": user_id}) or {}

    # Choose SMTP config: preferred account_id, else default account, else legacy single-config
    from plans import get_effective_plan, free_daily_limit  # local import to avoid cycles
    cfg: Optional[dict] = None
    if campaign.get("email_account_id"):
        cfg = await db.email_accounts.find_one({"id": campaign["email_account_id"], "user_id": user_id})
    if not cfg:
        cfg = await db.email_accounts.find_one({"user_id": user_id, "is_default": True})
    if not cfg:
        cfg = await db.email_accounts.find_one({"user_id": user_id})
    if not cfg:
        cfg = await db.email_configs.find_one({"user_id": user_id})
    if not cfg:
        raise HTTPException(400, "No SMTP config — set one in Settings first")

    plan = get_effective_plan(user)
    daily_cap = free_daily_limit(user)
    today_start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_sent = await db.campaign_history.count_documents(
        {"user_id": user_id, "status": "sent", "sent_at": {"$gte": today_start}}
    )

    from_addr = cfg.get("from_name") or cfg["smtp_user"]
    sent = 0
    failed = 0
    skipped_quota = 0
    skipped_ratelimit = 0
    delivery: List[dict] = []
    attachments = campaign.get("attachments") or []

    # Fetch full contact records for variable rendering
    recips = []
    async for c in db.contacts.find({"user_id": user_id, "id": {"$in": campaign["recipient_ids"]}}, {"_id": 0}):
        recips.append(c)

    for c in recips:
        # Free trial daily quota
        if daily_cap is not None and daily_sent >= daily_cap:
            skipped_quota += 1
            delivery.append({"email": c["email"], "status": "skipped_daily_quota"})
            continue

        # Anti-spam: max 3 emails per recipient in rolling 7 days
        one_week_ago = now() - timedelta(days=7)
        recent = await db.campaign_history.count_documents(
            {"user_id": user_id, "status": "sent",
             "recipient_email": {"$regex": f"^{re.escape(c['email'])}$", "$options": "i"},
             "sent_at": {"$gte": one_week_ago}}
        )
        if recent >= 3:
            skipped_ratelimit += 1
            delivery.append({"email": c["email"], "status": "skipped_ratelimit"})
            continue

        subject_rendered = _render_vars(campaign["subject"], c)
        body_rendered = _render_vars(campaign["body_html"], c)

        ok, err = send_smtp(
            host=cfg["smtp_host"],
            port=int(cfg.get("smtp_port", 587)),
            username=cfg["smtp_user"],
            password=cfg["smtp_pass"],
            from_addr=from_addr,
            to=c["email"],
            subject=subject_rendered,
            html=body_rendered,
            use_tls=bool(cfg.get("use_tls", True)),
            attachments=attachments if attachments else None,
        )
        rec = {
            "id": str(uuid.uuid4()), "user_id": user_id,
            "campaign_id": campaign_id, "recipient_email": c["email"],
            "sent_at": now(),
        }
        if ok:
            sent += 1
            daily_sent += 1
            rec["status"] = "sent"
            delivery.append({"email": c["email"], "status": "sent"})
        else:
            failed += 1
            rec["status"] = "failed"
            rec["error"] = err
            delivery.append({"email": c["email"], "status": "failed", "error": err})
        await db.campaign_history.insert_one(rec)

    await db.campaigns.update_one(
        {"id": campaign_id, "user_id": user_id},
        {"$set": {
            "status": "sent",
            "sent_count": sent,
            "failed_count": failed,
            "skipped_quota_count": skipped_quota,
            "skipped_ratelimit_count": skipped_ratelimit,
            "sent_at": now(),
            "updated_at": now(),
        }},
    )
    return {
        "ok": True, "sent": sent, "failed": failed,
        "skipped_daily_quota": skipped_quota, "skipped_ratelimit": skipped_ratelimit,
        "plan": plan, "delivery": delivery,
    }


@api.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Campaign not found")
    for k in ("created_at", "updated_at", "sent_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc


# ─────────────────────────  ANALYTICS  ─────────────────────────
@api.get("/analytics")
async def analytics(user_id: str = Depends(get_current_user_id)):
    contacts_count = await db.contacts.count_documents({"user_id": user_id})
    # Scans this month (contacts created this month with source ocr)
    month_start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    scans_month = await db.contacts.count_documents({
        "user_id": user_id, "source": "ocr", "created_at": {"$gte": month_start},
    })
    campaigns_count = await db.campaigns.count_documents({"user_id": user_id})
    emails_sent = await db.campaign_history.count_documents({"user_id": user_id, "status": "sent"})

    # Industry pie
    industry_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "industry": {"$ne": ""}}},
        {"$group": {"_id": "$industry", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8},
    ])
    industries = [{"label": d["_id"] or "Unknown", "count": d["count"]} async for d in industry_agg]

    # Country pie
    country_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "country": {"$ne": ""}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8},
    ])
    countries = [{"label": d["_id"] or "Unknown", "count": d["count"]} async for d in country_agg]

    # Growth: last 30 days
    thirty_days_ago = now() - timedelta(days=30)
    growth_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "created_at": {"$gte": thirty_days_ago}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ])
    growth = [{"date": d["_id"], "count": d["count"]} async for d in growth_agg]

    return {
        "contacts_total": contacts_count,
        "scans_this_month": scans_month,
        "campaigns_total": campaigns_count,
        "emails_sent": emails_sent,
        "industries": industries,
        "countries": countries,
        "growth": growth,
    }


# ─────────────────────────  MOUNT  ─────────────────────────

from fastapi import Response, UploadFile, File  # noqa: E402
from plans import PLANS, get_effective_plan, has_feature, free_daily_limit, FREE_TRIAL_DAYS  # noqa: E402
from excel_utils import build_export, build_template, parse_workbook  # noqa: E402

RESERVED_VARS = ["ContactName", "CompanyName", "Designation", "City", "Industry"]


def _render_vars(text: str, contact: dict) -> str:
    """Replace {{Var}} placeholders with contact fields."""
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
    # Legacy {name} placeholder
    text = text.replace("{name}", m["ContactName"])
    return text


# ─────────────────────────  SUBSCRIPTION / BILLING  ─────────────────────────
@api.get("/billing/status")
async def billing_status(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    plan = get_effective_plan(user)
    today_start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_sent = await db.campaign_history.count_documents(
        {"user_id": user_id, "status": "sent", "sent_at": {"$gte": today_start}}
    )
    daily_cap = free_daily_limit(user)
    return {
        "plan": plan,
        "plan_details": PLANS[plan],
        "trial_days": FREE_TRIAL_DAYS,
        "daily_sent": daily_sent,
        "daily_cap": daily_cap,  # None means unlimited
        "remaining_today": (None if daily_cap is None else max(0, daily_cap - daily_sent)),
        "subscription_current_period_end": iso(user["subscription_current_period_end"])
            if isinstance(user.get("subscription_current_period_end"), datetime) else None,
        "razorpay_configured": bool(os.environ.get("RAZORPAY_KEY_ID")),
    }


class CheckoutIn(BaseModel):
    plan: str  # "basic" | "pro"
    cycle: str  # "monthly" | "yearly"


@api.post("/billing/checkout")
async def billing_checkout(body: CheckoutIn, user_id: str = Depends(get_current_user_id)):
    if body.plan not in ("basic", "pro") or body.cycle not in ("monthly", "yearly"):
        raise HTTPException(400, "Invalid plan or cycle")
    key_id = os.environ.get("RAZORPAY_KEY_ID", "")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not key_id or not key_secret:
        raise HTTPException(
            503,
            "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env."
        )
    try:
        import razorpay  # type: ignore
        rz = razorpay.Client(auth=(key_id, key_secret))
        amount = PLANS[body.plan]["price_" + body.cycle] * 100  # paise
        order = rz.order.create({
            "amount": amount,
            "currency": "INR",
            "receipt": f"cv_{user_id[:8]}_{int(datetime.utcnow().timestamp())}",
            "notes": {"user_id": user_id, "plan": body.plan, "cycle": body.cycle},
        })
        # Persist a pending order for the webhook to match on
        await db.billing_orders.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "order_id": order["id"],
            "plan": body.plan,
            "cycle": body.cycle,
            "amount": amount,
            "status": "created",
            "created_at": now(),
        })
        return {"order_id": order["id"], "amount": amount, "currency": "INR", "key_id": key_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("razorpay checkout failed")
        raise HTTPException(500, f"Checkout failed: {e}")


class VerifyPaymentIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    plan: str
    cycle: str


@api.post("/billing/verify")
async def billing_verify(body: VerifyPaymentIn, user_id: str = Depends(get_current_user_id)):
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not key_secret:
        raise HTTPException(503, "Razorpay not configured")
    try:
        import razorpay  # type: ignore
        rz = razorpay.Client(auth=(os.environ["RAZORPAY_KEY_ID"], key_secret))
        rz.utility.verify_payment_signature({
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
        })
    except Exception as e:
        raise HTTPException(400, f"Invalid payment signature: {e}")
    period_days = 30 if body.cycle == "monthly" else 365
    period_end = now() + timedelta(days=period_days)
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": body.plan,
        "subscription_cycle": body.cycle,
        "subscription_id": body.razorpay_payment_id,
        "subscription_current_period_end": period_end,
        "updated_at": now(),
    }})
    await db.billing_orders.update_one(
        {"order_id": body.razorpay_order_id},
        {"$set": {"status": "paid", "payment_id": body.razorpay_payment_id, "paid_at": now()}},
    )
    return {"ok": True, "plan": body.plan, "period_end": iso(period_end)}


@api.post("/billing/cancel")
async def billing_cancel(user_id: str = Depends(get_current_user_id)):
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": "free",
        "subscription_current_period_end": None,
        "updated_at": now(),
    }})
    return {"ok": True}


@api.get("/billing/history")
async def billing_history(user_id: str = Depends(get_current_user_id)):
    cur = db.billing_orders.find({"user_id": user_id, "status": "paid"}, {"_id": 0}).sort("paid_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "paid_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


# ─────────────────────────  EXCEL IMPORT / EXPORT  ─────────────────────────
class ExportIn(BaseModel):
    contact_ids: List[str] = []
    search: Optional[str] = None
    tag: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    favorite: Optional[bool] = None


@api.post("/contacts/export")
async def export_contacts(body: ExportIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "excel_export"):
        raise HTTPException(402, "Upgrade to Basic to unlock Excel export.")
    q: Dict[str, Any] = {"user_id": user_id}
    if body.contact_ids:
        q["id"] = {"$in": body.contact_ids}
    else:
        if body.tag: q["tags"] = body.tag.lower()
        if body.industry: q["industry"] = body.industry
        if body.country: q["country"] = body.country
        if body.state: q["state"] = body.state
        if body.city: q["city"] = body.city
        if body.favorite is not None: q["favorite"] = body.favorite
        if body.search:
            rx = {"$regex": body.search, "$options": "i"}
            q["$or"] = [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}]
    cur = db.contacts.find(q, {"_id": 0})
    contacts = [c async for c in cur]
    data = build_export(contacts)
    b64 = base64.b64encode(data).decode("ascii")
    return {
        "filename": f"cardvault_contacts_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx",
        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "count": len(contacts),
        "content_b64": b64,
    }


@api.get("/contacts/import/template")
async def import_template(user_id: str = Depends(get_current_user_id)):
    data = build_template()
    return {
        "filename": "cardvault_import_template.xlsx",
        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content_b64": base64.b64encode(data).decode("ascii"),
    }


class ImportPreviewIn(BaseModel):
    content_b64: str


@api.post("/contacts/import/preview")
async def import_preview(body: ImportPreviewIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "excel_import"):
        raise HTTPException(402, "Upgrade to Basic to unlock Excel import.")
    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(400, "Invalid file payload")
    rows, errors = parse_workbook(raw)

    # Detect duplicates against existing user's contacts
    existing_emails = set()
    existing_phones = set()
    cur = db.contacts.find({"user_id": user_id}, {"email": 1, "phone": 1, "_id": 0})
    async for c in cur:
        if c.get("email"):
            existing_emails.add(c["email"].lower().strip())
        if c.get("phone"):
            digits = "".join(ch for ch in c["phone"] if ch.isdigit())
            if len(digits) >= 7:
                existing_phones.add(digits[-10:])

    new_count = updated_count = skipped_count = failed_count = 0
    preview: List[dict] = []
    for r in rows:
        row_out = {**r}
        if r.get("_error"):
            row_out["_action"] = "failed"
            failed_count += 1
        else:
            is_dup = False
            if r.get("email") and r["email"].lower().strip() in existing_emails:
                is_dup = True
            if not is_dup and r.get("phone"):
                d = "".join(ch for ch in r["phone"] if ch.isdigit())
                if len(d) >= 7 and d[-10:] in existing_phones:
                    is_dup = True
            if is_dup:
                row_out["_action"] = "update"
                updated_count += 1
            else:
                row_out["_action"] = "new"
                new_count += 1
        preview.append(row_out)
    return {
        "total": len(rows),
        "new": new_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "errors": errors[:20],
        "preview": preview[:200],
    }


class ImportCommitIn(BaseModel):
    content_b64: str
    duplicate_strategy: str = "merge"  # "merge" | "skip"


@api.post("/contacts/import/commit")
async def import_commit(body: ImportCommitIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "excel_import"):
        raise HTTPException(402, "Upgrade to Basic to unlock Excel import.")
    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(400, "Invalid file payload")
    rows, _errors = parse_workbook(raw)

    imported = updated = skipped = failed = 0
    for r in rows:
        if r.get("_error"):
            failed += 1
            continue
        # Find existing contact by email or phone
        existing = None
        if r.get("email"):
            existing = await db.contacts.find_one({
                "user_id": user_id, "email": {"$regex": f"^{re.escape(r['email'])}$", "$options": "i"},
            })
        if not existing and r.get("phone"):
            digits = "".join(ch for ch in str(r["phone"]) if ch.isdigit())
            if len(digits) >= 7:
                suffix = digits[-10:]
                # Search all contacts and match last 10 digits
                cur2 = db.contacts.find({"user_id": user_id})
                async for c in cur2:
                    d2 = "".join(ch for ch in (c.get("phone") or "") if ch.isdigit())
                    if len(d2) >= 7 and d2[-10:] == suffix:
                        existing = c
                        break
        clean_row = {k: v for k, v in r.items() if not k.startswith("_")}
        clean_row["tags"] = _normalize_tags(clean_row.get("tags", []))

        if existing:
            if body.duplicate_strategy == "skip":
                skipped += 1
                continue
            # Merge — fill blanks in existing with values from row, and union tags
            updates: Dict[str, Any] = {}
            for k, v in clean_row.items():
                if k == "tags":
                    merged = list(dict.fromkeys((existing.get("tags") or []) + v))
                    updates["tags"] = merged
                elif v and not existing.get(k):
                    updates[k] = v
            if updates:
                updates["updated_at"] = now()
                await db.contacts.update_one({"id": existing["id"]}, {"$set": updates})
            updated += 1
        else:
            doc = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                **clean_row,
                "source": "import",
                "favorite": False,
                "social_links": {},
                "created_at": now(),
                "updated_at": now(),
            }
            await db.contacts.insert_one(doc)
            imported += 1
    return {
        "total": len(rows),
        "imported": imported,
        "updated": updated,
        "duplicate_removed": skipped,
        "failed": failed,
    }


# ─────────────────────────  EMAIL ACCOUNTS (multi)  ─────────────────────────
class EmailAccountIn(BaseModel):
    label: str
    provider: str
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_pass: str
    from_name: str = ""
    reply_to: str = ""
    use_tls: bool = True
    is_default: bool = False


@api.get("/settings/emails")
async def list_email_accounts(user_id: str = Depends(get_current_user_id)):
    cur = db.email_accounts.find({"user_id": user_id}, {"_id": 0, "smtp_pass": 0})
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@api.post("/settings/emails")
async def add_email_account(body: EmailAccountIn, user_id: str = Depends(get_current_user_id)):
    if body.is_default:
        await db.email_accounts.update_many({"user_id": user_id}, {"$set": {"is_default": False}})
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()), "user_id": user_id,
        "created_at": now(), "updated_at": now(),
    })
    await db.email_accounts.insert_one(dict(doc))
    return clean_doc(dict(doc))


@api.delete("/settings/emails/{account_id}")
async def delete_email_account(account_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.email_accounts.delete_one({"id": account_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/settings/emails/{account_id}/default")
async def set_default_email(account_id: str, user_id: str = Depends(get_current_user_id)):
    await db.email_accounts.update_many({"user_id": user_id}, {"$set": {"is_default": False}})
    res = await db.email_accounts.update_one({"id": account_id, "user_id": user_id}, {"$set": {"is_default": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/settings/emails/{account_id}/test")
async def test_email_account(account_id: str, body: TestSmtpIn, user_id: str = Depends(get_current_user_id)):
    cfg = await db.email_accounts.find_one({"id": account_id, "user_id": user_id})
    if not cfg:
        raise HTTPException(404, "Not found")
    from_addr = cfg.get("from_name") or cfg["smtp_user"]
    ok, err = send_smtp(
        host=cfg["smtp_host"], port=int(cfg.get("smtp_port", 587)),
        username=cfg["smtp_user"], password=cfg["smtp_pass"],
        from_addr=from_addr, to=body.to,
        subject="CardVault test email",
        html="<p>Your CardVault SMTP configuration works ✔</p>",
        text="Your CardVault SMTP configuration works.",
        use_tls=bool(cfg.get("use_tls", True)),
    )
    if not ok:
        raise HTTPException(400, f"SMTP test failed: {err}")
    return {"ok": True}


# ─────────────────────────  RECIPIENT QUOTA / STATUS  ─────────────────────────
# (recipient_status handler moved above /contacts/{contact_id} to avoid path
# collision — see the earlier declaration.)


# ─────────────────────────  WHATSAPP TEMPLATES  ─────────────────────────
class WaTemplateIn(BaseModel):
    name: str
    body: str


@api.get("/whatsapp/templates")
async def list_wa_templates(user_id: str = Depends(get_current_user_id)):
    cur = db.wa_templates.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@api.post("/whatsapp/templates")
async def create_wa_template(body: WaTemplateIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "whatsapp_templates"):
        raise HTTPException(402, "Upgrade to Pro to unlock WhatsApp features.")
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now(), "updated_at": now()})
    await db.wa_templates.insert_one(dict(doc))
    return clean_doc(dict(doc))


@api.delete("/whatsapp/templates/{template_id}")
async def delete_wa_template(template_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.wa_templates.delete_one({"id": template_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


class WaLinksIn(BaseModel):
    body: str
    contact_ids: List[str] = []


@api.post("/whatsapp/generate-links")
async def wa_generate_links(body: WaLinksIn, user_id: str = Depends(get_current_user_id)):
    """Return per-contact wa.me links with personalized messages.

    The client opens each link (wa.me) to send via the user's WhatsApp app —
    no WhatsApp Business API required.
    """
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "whatsapp_campaign"):
        raise HTTPException(402, "Upgrade to Pro to unlock WhatsApp campaigns.")
    cur = db.contacts.find({"user_id": user_id, "id": {"$in": body.contact_ids}}, {"_id": 0})
    from urllib.parse import quote
    out = []
    async for c in cur:
        phone = "".join(ch for ch in (c.get("phone") or "") if ch.isdigit())
        if not phone or len(phone) < 7:
            continue
        text = _render_vars(body.body, c)
        out.append({
            "contact_id": c["id"],
            "name": c.get("name") or c.get("company") or c["phone"],
            "phone": phone,
            "url": f"https://wa.me/{phone}?text={quote(text)}",
            "personalized": text,
        })
    return {"items": out, "count": len(out)}

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    client.close()
