"""OCR + AI parsing for business cards.

Pipeline:
1. Decode base64 image -> Pillow.
2. Pre-process: convert to grayscale, resize.
3. Run pytesseract to extract raw text.
4. Regex-extract phone / email / website.
5. Use Emergent LLM (Claude Haiku via emergentintegrations) to parse remaining fields
   into structured JSON (name, designation, company, address, city, state, country, pincode).
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
from typing import Any, Dict, List

from PIL import Image, ImageOps
import pytesseract

logger = logging.getLogger("ocr")

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(
    r"(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?"
)
WEBSITE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+(?:/[^\s]*)?",
)
PIN_RE = re.compile(r"\b\d{5,6}\b")


def _decode_image(b64: str) -> Image.Image:
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    return img.convert("RGB")


def _preprocess(img: Image.Image) -> Image.Image:
    # Resize very large images to reduce OCR time.
    max_side = 1800
    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)))
    # Grayscale + auto contrast helps tesseract.
    img = ImageOps.grayscale(img)
    img = ImageOps.autocontrast(img)
    return img


def _extract_regex_fields(text: str) -> Dict[str, Any]:
    emails: List[str] = list({m.group(0) for m in EMAIL_RE.finditer(text)})
    websites_raw: List[str] = list({m.group(0) for m in WEBSITE_RE.finditer(text)})
    # Filter false-positive websites (drop pure emails).
    websites: List[str] = []
    for w in websites_raw:
        if "@" in w:
            continue
        low = w.lower()
        if low.endswith((".jpg", ".png", ".jpeg")):
            continue
        websites.append(w)
    # Phones — allow only plausible ones (7-15 digits after stripping).
    phones: List[str] = []
    for m in PHONE_RE.finditer(text):
        raw = m.group(0)
        digits = re.sub(r"\D", "", raw)
        if 7 <= len(digits) <= 15 and digits not in (p.replace(" ", "").replace("-", "") for p in phones):
            phones.append(raw.strip())
    pincode = None
    m = PIN_RE.search(text)
    if m:
        pincode = m.group(0)
    return {
        "emails": emails,
        "websites": websites,
        "phones": phones,
        "pincode": pincode,
    }


async def _ai_parse(raw_text: str, regex_hits: Dict[str, Any]) -> Dict[str, Any]:
    """Use Emergent LLM (Claude Haiku) to structure the remaining fields."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning("emergentintegrations import failed: %s", e)
        return {}

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return {}

    prompt = f"""You are a business-card parser. Given raw OCR text from a business card, return ONLY valid JSON with these keys (use empty string when unknown):
{{
  "name": "Person's full name",
  "designation": "Job title / role",
  "company": "Company name",
  "address": "Full street address (single line)",
  "city": "",
  "state": "",
  "country": "",
  "industry": "Guess industry if obvious, else empty"
}}

Already extracted via regex (don't repeat, focus on the rest):
- Emails: {regex_hits.get('emails')}
- Phones: {regex_hits.get('phones')}
- Websites: {regex_hits.get('websites')}
- Pincode: {regex_hits.get('pincode')}

Raw OCR text (line breaks preserved):
---
{raw_text}
---
Return ONLY the JSON object, no code fences, no commentary."""

    try:
        chat = (
            LlmChat(api_key=api_key, session_id=f"ocr-{os.urandom(4).hex()}", system_message="You extract business card fields into strict JSON.")
            .with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
        # Try to parse JSON from response.
        text = resp.strip()
        # Strip code fences if present.
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        data = json.loads(text)
        return {k: (v or "") for k, v in data.items() if isinstance(k, str)}
    except Exception as e:
        logger.exception("AI parse failed: %s", e)
        return {}


async def scan_business_card(image_b64: str) -> Dict[str, Any]:
    """Run full pipeline. Returns structured card dict + raw text + confidence hint."""
    img = _decode_image(image_b64)
    processed = _preprocess(img)
    try:
        raw_text = pytesseract.image_to_string(processed)
    except Exception as e:
        logger.exception("tesseract failed")
        raise RuntimeError(f"OCR failed: {e}")

    raw_text = raw_text.strip()
    regex_hits = _extract_regex_fields(raw_text)
    ai_fields = await _ai_parse(raw_text, regex_hits)

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
        "pincode": regex_hits.get("pincode") or "",
        "industry": ai_fields.get("industry", ""),
        "all_emails": regex_hits["emails"],
        "all_phones": regex_hits["phones"],
        "all_websites": regex_hits["websites"],
        "confidence": "high" if raw_text and (regex_hits["emails"] or regex_hits["phones"]) else "medium",
    }
