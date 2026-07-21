"""Campaign creation + sending with anti-spam quotas."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import clean_doc, db, iso, now, render_vars
from email_utils import send_smtp
from plans import free_daily_limit, get_effective_plan
from schemas import CampaignIn

router = APIRouter(tags=["campaigns"])


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
    dedup: Dict[str, dict] = {}
    for c in contacts:
        dedup.setdefault(c["email"].lower(), c)
    return list(dedup.values())


@router.get("/campaigns")
async def list_campaigns(user_id: str = Depends(get_current_user_id)):
    cur = db.campaigns.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at", "sent_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@router.post("/campaigns")
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


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(campaign_id: str, user_id: str = Depends(get_current_user_id)):
    campaign = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    user = await db.users.find_one({"id": user_id}) or {}

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
    sent = failed = skipped_quota = skipped_ratelimit = 0
    delivery: List[dict] = []
    attachments = campaign.get("attachments") or []

    recips = []
    async for c in db.contacts.find({"user_id": user_id, "id": {"$in": campaign["recipient_ids"]}}, {"_id": 0}):
        recips.append(c)

    for c in recips:
        if daily_cap is not None and daily_sent >= daily_cap:
            skipped_quota += 1
            delivery.append({"email": c["email"], "status": "skipped_daily_quota"})
            continue

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

        subject_rendered = render_vars(campaign["subject"], c)
        body_rendered = render_vars(campaign["body_html"], c)

        ok, err = send_smtp(
            host=cfg["smtp_host"], port=int(cfg.get("smtp_port", 587)),
            username=cfg["smtp_user"], password=cfg["smtp_pass"],
            from_addr=from_addr, to=c["email"],
            subject=subject_rendered, html=body_rendered,
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
            "sent_count": sent, "failed_count": failed,
            "skipped_quota_count": skipped_quota,
            "skipped_ratelimit_count": skipped_ratelimit,
            "sent_at": now(), "updated_at": now(),
        }},
    )
    return {
        "ok": True, "sent": sent, "failed": failed,
        "skipped_daily_quota": skipped_quota, "skipped_ratelimit": skipped_ratelimit,
        "plan": plan, "delivery": delivery,
    }


@router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.campaigns.find_one({"id": campaign_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Campaign not found")
    for k in ("created_at", "updated_at", "sent_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc
