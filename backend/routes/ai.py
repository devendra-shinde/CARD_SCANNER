"""AI-adjacent endpoints: OCR scan, AI email assistant, web enrichment."""
from __future__ import annotations

import json
import os
import re

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import logger
from enrich_utils import scrape_website
from ocr_utils import OcrError, scan_business_card
from schemas import AiEmailIn, EnrichIn, OcrIn

router = APIRouter(tags=["ai"])


@router.post("/ocr/scan")
async def ocr_scan(body: OcrIn, user_id: str = Depends(get_current_user_id)):
    try:
        return await scan_business_card(body.image_b64)
    except OcrError as e:
        raise HTTPException(422, str(e))
    except Exception:
        logger.exception("scan failed")
        raise HTTPException(
            500,
            "OCR service is temporarily unavailable. Please add the contact manually — we'll auto-fill what we can.",
        )


@router.post("/ai/write-email")
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
            LlmChat(
                api_key=api_key,
                session_id=f"aiemail-{os.urandom(4).hex()}",
                system_message="You are an expert B2B copywriter. Return only JSON.",
            ).with_model("anthropic", "claude-haiku-4-5-20251001")
        )
        resp = await chat.send_message(UserMessage(text=prompt))
        text = (resp or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        try:
            data = json.loads(text, strict=False)
        except json.JSONDecodeError:
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


@router.post("/enrich")
async def enrich(body: EnrichIn, user_id: str = Depends(get_current_user_id)):
    if not body.website and not body.company:
        raise HTTPException(400, "Provide website or company")
    if body.website:
        return await scrape_website(body.website)
    return {"note": "company-only enrichment requires web search — provide a website URL."}
