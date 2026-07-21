"""Pydantic request/response schemas shared across route modules."""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# ──────────────────────────  AUTH  ─────────────────────────────
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


class GoogleSessionIn(BaseModel):
    session_id: str


# ────────────────────────  CONTACTS  ───────────────────────────
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
    image_b64: Optional[str] = None
    avatar_b64: Optional[str] = None
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


# ────────────────────────  AI / OCR  ───────────────────────────
class OcrIn(BaseModel):
    image_b64: str


class EnrichIn(BaseModel):
    website: Optional[str] = ""
    company: Optional[str] = ""


class AiEmailIn(BaseModel):
    action: str  # generate | rewrite | shorten | expand | formalize | friendly
    prompt: Optional[str] = ""
    subject: Optional[str] = ""
    body: Optional[str] = ""
    tone: Optional[str] = ""


# ────────────────────────  SETTINGS  ───────────────────────────
class EmailConfigIn(BaseModel):
    provider: str  # gmail | outlook | yahoo | custom
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_pass: str
    from_name: str = ""
    reply_to: str = ""
    use_tls: bool = True


class TestSmtpIn(BaseModel):
    to: EmailStr


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


# ────────────────────────  TEMPLATES  ───────────────────────────
class TemplateIn(BaseModel):
    name: str
    subject: str
    body_html: str


# ────────────────────────  CAMPAIGNS  ───────────────────────────
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
    filter_tag: Optional[str] = None       # legacy
    filter_industry: Optional[str] = None  # legacy
    attachments: List[Dict[str, str]] = []
    email_account_id: Optional[str] = None


# ────────────────────────  BILLING  ─────────────────────────────
class CheckoutIn(BaseModel):
    plan: str  # basic | pro
    cycle: str  # monthly | yearly


class VerifyPaymentIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    plan: str
    cycle: str


# ────────────────────────  EXCEL  ──────────────────────────────
class ExportIn(BaseModel):
    contact_ids: List[str] = []
    search: Optional[str] = None
    tag: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    favorite: Optional[bool] = None


class ImportPreviewIn(BaseModel):
    content_b64: str


class ImportCommitIn(BaseModel):
    content_b64: str
    duplicate_strategy: str = "merge"  # merge | skip


# ────────────────────────  WHATSAPP  ────────────────────────────
class WaTemplateIn(BaseModel):
    name: str
    body: str


class WaLinksIn(BaseModel):
    body: str
    contact_ids: List[str] = []
