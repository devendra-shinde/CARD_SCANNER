"""WhatsApp templates + wa.me link generation (Pro tier)."""
from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import clean_doc, db, iso, now, render_vars
from plans import has_feature
from schemas import WaLinksIn, WaTemplateIn

router = APIRouter(tags=["whatsapp"])


@router.get("/whatsapp/templates")
async def list_wa_templates(user_id: str = Depends(get_current_user_id)):
    cur = db.wa_templates.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@router.post("/whatsapp/templates")
async def create_wa_template(body: WaTemplateIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "whatsapp_templates"):
        raise HTTPException(402, "Upgrade to Pro to unlock WhatsApp features.")
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now(), "updated_at": now()})
    await db.wa_templates.insert_one(dict(doc))
    return clean_doc(dict(doc))


@router.delete("/whatsapp/templates/{template_id}")
async def delete_wa_template(template_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.wa_templates.delete_one({"id": template_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.post("/whatsapp/generate-links")
async def wa_generate_links(body: WaLinksIn, user_id: str = Depends(get_current_user_id)):
    """Return per-contact wa.me links with personalized messages.

    The client opens each link (wa.me) to send via the user's WhatsApp app —
    no WhatsApp Business API required.
    """
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "whatsapp_campaign"):
        raise HTTPException(402, "Upgrade to Pro to unlock WhatsApp campaigns.")
    cur = db.contacts.find({"user_id": user_id, "id": {"$in": body.contact_ids}}, {"_id": 0})
    out = []
    async for c in cur:
        phone = "".join(ch for ch in (c.get("phone") or "") if ch.isdigit())
        if not phone or len(phone) < 7:
            continue
        text = render_vars(body.body, c)
        out.append({
            "contact_id": c["id"],
            "name": c.get("name") or c.get("company") or c["phone"],
            "phone": phone,
            "url": f"https://wa.me/{phone}?text={quote(text)}",
            "personalized": text,
        })
    return {"items": out, "count": len(out)}
