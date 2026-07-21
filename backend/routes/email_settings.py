"""Email SMTP config (single legacy config + multi-account list)."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import clean_doc, db, iso, now
from email_utils import send_smtp
from schemas import EmailAccountIn, EmailConfigIn, TestSmtpIn

router = APIRouter(tags=["email-settings"])


# Legacy single-config endpoints (kept for backwards compat with old app builds)
@router.get("/settings/email")
async def get_email_config(user_id: str = Depends(get_current_user_id)):
    doc = await db.email_configs.find_one({"user_id": user_id}, {"_id": 0, "smtp_pass": 0})
    return doc or {}


@router.post("/settings/email")
async def set_email_config(body: EmailConfigIn, user_id: str = Depends(get_current_user_id)):
    doc = body.model_dump()
    doc.update({"user_id": user_id, "updated_at": now()})
    await db.email_configs.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    return {"ok": True}


@router.post("/settings/email/test")
async def test_email_config(body: TestSmtpIn, user_id: str = Depends(get_current_user_id)):
    cfg = await db.email_configs.find_one({"user_id": user_id})
    if not cfg:
        raise HTTPException(400, "No email config saved")
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


# Multi-account endpoints
@router.get("/settings/emails")
async def list_email_accounts(user_id: str = Depends(get_current_user_id)):
    cur = db.email_accounts.find({"user_id": user_id}, {"_id": 0, "smtp_pass": 0})
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@router.post("/settings/emails")
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


@router.delete("/settings/emails/{account_id}")
async def delete_email_account(account_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.email_accounts.delete_one({"id": account_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.post("/settings/emails/{account_id}/default")
async def set_default_email(account_id: str, user_id: str = Depends(get_current_user_id)):
    await db.email_accounts.update_many({"user_id": user_id}, {"$set": {"is_default": False}})
    res = await db.email_accounts.update_one(
        {"id": account_id, "user_id": user_id}, {"$set": {"is_default": True}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.post("/settings/emails/{account_id}/test")
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
