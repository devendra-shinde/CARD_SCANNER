"""OCR + AI parsing for business cards.

Strategy (2026):
1. **Primary**: Claude Haiku 4.5 vision via emergentintegrations — most reliable, no
   native dependencies, returns structured JSON in one shot.
2. **Fallback**: pytesseract + regex + Claude text parse — used when the vision call
   fails (network / api). Requires the `tesseract-ocr` binary.
3. **Hard failure**: return a clear, user-friendly error so the app can prompt the
   user to enter fields manually.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import shutil
from typing import Any, Dict, List

from PIL import Image, ImageOps

logger = logging.getLogger("ocr")

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(
    r"(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?"
)
WEBSITE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+(?:/[^\s]*)?",
)
PIN_RE = re.compile(r"\b\d{5,6}\b")


class OcrError(Exception):
    """Raised when OCR could not extract anything usable."""


def _decode_image(b64: str) -> Image.Image:
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    return img.convert("RGB")


def _preprocess(img: Image.Image) -> Image.Image:
    max_side = 1800
    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)))
    img = ImageOps.grayscale(img)
    img = ImageOps.autocontrast(img)
    return img


def _extract_regex_fields(text: str) -> Dict[str, Any]:
    emails: List[str] = list({m.group(0) for m in EMAIL_RE.finditer(text)})
    websites_raw: List[str] = list({m.group(0) for m in WEBSITE_RE.finditer(text)})
    websites: List[str] = []
    for w in websites_raw:
        if "@" in w:
            continue
        low = w.lower()
        if low.endswith((".jpg", ".png", ".jpeg")):
            continue
        websites.append(w)
    phones: List[str] = []
    seen: set = set()
    for m in PHONE_RE.finditer(text):
        raw = m.group(0)
        digits = re.sub(r"\D", "", raw)
        if 7 <= len(digits) <= 15 and digits not in seen:
            phones.append(raw.strip())
            seen.add(digits)
    pincode = None
    m = PIN_RE.search(text)
    if m:
        pincode = m.group(0)
    return {"emails": emails, "websites": websites, "phones": phones, "pincode": pincode}


async def _vision_extract(image_b64: str) -> Dict[str, Any] | None:
    """Primary path: Claude Haiku vision reads the card image and returns structured JSON.

    Returns None on any error so the caller can try the tesseract fallback.
    """
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return None
    try:
        from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    except Exception as e:
        logger.warning("emergentintegrations unavailable: %s", e)
        return None

    prompt = """You are a business-card OCR engine. Read the attached business-card image
and return ONLY valid JSON with these exact keys (empty string when unknown):

{
  "raw_text": "everything you can read on the card, line-broken",
  "name": "person's full name",
  "designation": "job title / role",
  "company": "company name",
  "email": "primary email address",
  "phone": "primary phone / mobile number (keep the +country-code if present)",
  "website": "primary website domain (strip https://)",
  "address": "street address on a single line (not city/state/pin)",
  "city": "",
  "state": "",
  "country": "",
  "pincode": "postal code / ZIP / PIN if visible",
  "industry": "guess if obvious, else empty",
  "all_emails": ["every email visible"],
  "all_phones": ["every phone number visible"],
  "all_websites": ["every URL visible"]
}

Return ONLY the JSON object, no code fences, no commentary."""

    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"ocr-{os.urandom(4).hex()}", system_message="You extract business-card fields into strict JSON.")
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        img = ImageContent(image_base64=image_b64)
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[img]))
        text = (resp or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        data = json.loads(text)
        # Normalise types + fill missing keys
        out: Dict[str, Any] = {
            "raw_text": str(data.get("raw_text", "") or ""),
            "name": str(data.get("name", "") or ""),
            "designation": str(data.get("designation", "") or ""),
            "company": str(data.get("company", "") or ""),
            "email": str(data.get("email", "") or ""),
            "phone": str(data.get("phone", "") or ""),
            "website": str(data.get("website", "") or ""),
            "address": str(data.get("address", "") or ""),
            "city": str(data.get("city", "") or ""),
            "state": str(data.get("state", "") or ""),
            "country": str(data.get("country", "") or ""),
            "pincode": str(data.get("pincode", "") or ""),
            "industry": str(data.get("industry", "") or ""),
            "all_emails": [str(x) for x in (data.get("all_emails") or []) if x],
            "all_phones": [str(x) for x in (data.get("all_phones") or []) if x],
            "all_websites": [str(x) for x in (data.get("all_websites") or []) if x],
            "confidence": "high" if data.get("name") or data.get("email") or data.get("phone") else "medium",
            "engine": "claude-haiku-vision",
        }
        return out
    except Exception as e:
        logger.warning("Vision OCR failed, will try tesseract fallback: %s", e)
        return None


async def _ai_text_parse(raw_text: str, regex_hits: Dict[str, Any]) -> Dict[str, Any]:
    """Fallback text parser (Claude) — used only after tesseract text extraction."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {}
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return {}

    prompt = f"""Given raw OCR text from a business card, return ONLY valid JSON with these keys (use empty string when unknown):
{{
  "name": "", "designation": "", "company": "", "address": "",
  "city": "", "state": "", "country": "", "pincode": "", "industry": ""
}}

Regex already extracted:
- Emails: {regex_hits.get('emails')}
- Phones: {regex_hits.get('phones')}
- Websites: {regex_hits.get('websites')}
- Pincode: {regex_hits.get('pincode')}

Raw OCR text:
---
{raw_text}
---
Return ONLY the JSON."""

    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"ocr-txt-{os.urandom(4).hex()}", system_message="You extract business card fields into strict JSON.")
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
        text = (resp or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        data = json.loads(text)
        return {k: (v or "") for k, v in data.items() if isinstance(k, str)}
    except Exception as e:
        logger.warning("AI text parse failed: %s", e)
        return {}


async def _tesseract_extract(image_b64: str) -> Dict[str, Any] | None:
    """Fallback path: tesseract text extraction + regex + LLM text parse."""
    if not shutil.which("tesseract"):
        logger.warning("tesseract binary not on PATH — skipping fallback")
        return None
    try:
        import pytesseract  # type: ignore
    except ImportError:
        return None
    img = _decode_image(image_b64)
    processed = _preprocess(img)
    try:
        raw_text = pytesseract.image_to_string(processed)
    except Exception as e:
        logger.warning("pytesseract failed: %s", e)
        return None
    raw_text = (raw_text or "").strip()
    if not raw_text:
        return None
    regex_hits = _extract_regex_fields(raw_text)
    ai_fields = await _ai_text_parse(raw_text, regex_hits)
    return {
        "raw_text": raw_text,
        "name": ai_fields.get("name", ""),
        "designation": ai_fields.get("designation", ""),
        "company": ai_fields.get("company", ""),
        "email": (regex_hits["emails"][0] if regex_hits["emails"] else ""),
        "phone": (regex_hits["phones"][0] if regex_hits["phones"] else ""),
        "website": (regex_hits["websites"][0] if regex_hits["websites"] else ""),
        "address": ai_fields.get("address", ""),
        "city": ai_fields.get("city", ""),
        "state": ai_fields.get("state", ""),
        "country": ai_fields.get("country", ""),
        "pincode": ai_fields.get("pincode") or regex_hits.get("pincode") or "",
        "industry": ai_fields.get("industry", ""),
        "all_emails": regex_hits["emails"],
        "all_phones": regex_hits["phones"],
        "all_websites": regex_hits["websites"],
        "confidence": "medium",
        "engine": "tesseract",
    }


async def scan_business_card(image_b64: str) -> Dict[str, Any]:
    """Main entry — tries vision first, tesseract second, raises OcrError last."""
    # Primary — Claude vision
    vision_result = await _vision_extract(image_b64)
    if vision_result and (vision_result.get("name") or vision_result.get("email") or vision_result.get("phone") or vision_result.get("raw_text")):
        return vision_result

    # Fallback — tesseract
    ts_result = await _tesseract_extract(image_b64)
    if ts_result:
        return ts_result

    # Both failed — surface a friendly error
    raise OcrError(
        "We couldn't read this card automatically. Try a clearer, well-lit photo "
        "with the card filling the frame — or add the contact manually."
    )
