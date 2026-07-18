"""CardVault backend — Business Card OCR & Smart Contact Management."""
from __future__ import annotations

import logging
import os
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
from ocr_utils import scan_business_card  # noqa: E402

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
    filter_tag: Optional[str] = None
    filter_industry: Optional[str] = None


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
    tag: Optional[str] = None,
    industry: Optional[str] = None,
    company: Optional[str] = None,
    favorite: Optional[bool] = None,
    sort: str = "recent",  # recent | name | company
    limit: int = 500,
):
    q: Dict[str, Any] = {"user_id": user_id}
    if tag:
        q["tags"] = tag
    if industry:
        q["industry"] = industry
    if company:
        q["company"] = company
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
    except Exception as e:
        logger.exception("scan failed")
        raise HTTPException(500, f"OCR failed: {e}")


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
    if body.filter_tag:
        q["tags"] = body.filter_tag
    if body.filter_industry:
        q["industry"] = body.filter_industry
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
    cfg = await db.email_configs.find_one({"user_id": user_id})
    if not cfg:
        raise HTTPException(400, "No SMTP config — set one in Settings first")

    from_addr = cfg.get("from_name") or cfg["smtp_user"]
    sent = 0
    failed = 0
    delivery: List[dict] = []

    for email in campaign["recipient_emails"]:
        # anti-spam: max 3 campaigns per recipient per week
        one_week_ago = now() - timedelta(days=7)
        recent = await db.campaign_history.count_documents(
            {"user_id": user_id, "recipient_email": email, "sent_at": {"$gte": one_week_ago}}
        )
        if recent >= 3:
            delivery.append({"email": email, "status": "skipped_ratelimit"})
            continue

        ok, err = send_smtp(
            host=cfg["smtp_host"],
            port=int(cfg.get("smtp_port", 587)),
            username=cfg["smtp_user"],
            password=cfg["smtp_pass"],
            from_addr=from_addr,
            to=email,
            subject=campaign["subject"],
            html=campaign["body_html"],
            use_tls=bool(cfg.get("use_tls", True)),
        )
        if ok:
            sent += 1
            delivery.append({"email": email, "status": "sent"})
            await db.campaign_history.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "campaign_id": campaign_id,
                "recipient_email": email,
                "status": "sent",
                "sent_at": now(),
            })
        else:
            failed += 1
            delivery.append({"email": email, "status": "failed", "error": err})
            await db.campaign_history.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "campaign_id": campaign_id,
                "recipient_email": email,
                "status": "failed",
                "error": err,
                "sent_at": now(),
            })

    await db.campaigns.update_one(
        {"id": campaign_id, "user_id": user_id},
        {"$set": {
            "status": "sent",
            "sent_count": sent,
            "failed_count": failed,
            "sent_at": now(),
            "updated_at": now(),
        }},
    )
    return {"ok": True, "sent": sent, "failed": failed, "delivery": delivery}


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
