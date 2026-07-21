"""Excel import (preview + commit) and export.

Import commit builds an in-memory (email, phone-suffix) index over the
user's existing contacts ONCE, then does O(1) lookups per row. This
avoids the O(N×M) blowup that a per-row Mongo scan would cause on
large uploads.
"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import db, normalize_tags, now
from excel_utils import build_export, build_template, parse_workbook
from plans import has_feature
from schemas import ExportIn, ImportCommitIn, ImportPreviewIn

router = APIRouter(tags=["excel"])


@router.post("/contacts/export")
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


@router.get("/contacts/import/template")
async def import_template(user_id: str = Depends(get_current_user_id)):
    data = build_template()
    return {
        "filename": "cardvault_import_template.xlsx",
        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content_b64": base64.b64encode(data).decode("ascii"),
    }


@router.post("/contacts/import/preview")
async def import_preview(body: ImportPreviewIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "excel_import"):
        raise HTTPException(402, "Upgrade to Basic to unlock Excel import.")
    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(400, "Invalid file payload")
    rows, errors = parse_workbook(raw)

    existing_emails: set = set()
    existing_phones: set = set()
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


@router.post("/contacts/import/commit")
async def import_commit(body: ImportCommitIn, user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    if not has_feature(user, "excel_import"):
        raise HTTPException(402, "Upgrade to Basic to unlock Excel import.")
    try:
        raw = base64.b64decode(body.content_b64)
    except Exception:
        raise HTTPException(400, "Invalid file payload")
    rows, _errors = parse_workbook(raw)

    # Build in-memory dedupe indexes over the user's existing contacts ONCE.
    # This turns the previously O(N×M) phone-suffix scan into O(N+M).
    email_index: Dict[str, dict] = {}
    phone_suffix_index: Dict[str, dict] = {}
    async for c in db.contacts.find({"user_id": user_id}):
        em = (c.get("email") or "").strip().lower()
        if em and em not in email_index:
            email_index[em] = c
        digits = "".join(ch for ch in (c.get("phone") or "") if ch.isdigit())
        if len(digits) >= 7:
            suffix = digits[-10:]
            phone_suffix_index.setdefault(suffix, c)

    imported = updated = skipped = failed = 0
    for r in rows:
        if r.get("_error"):
            failed += 1
            continue
        existing = None
        row_email = (r.get("email") or "").strip().lower()
        if row_email:
            existing = email_index.get(row_email)
        if not existing and r.get("phone"):
            digits = "".join(ch for ch in str(r["phone"]) if ch.isdigit())
            if len(digits) >= 7:
                existing = phone_suffix_index.get(digits[-10:])
        clean_row = {k: v for k, v in r.items() if not k.startswith("_")}
        clean_row["tags"] = normalize_tags(clean_row.get("tags", []))

        if existing:
            if body.duplicate_strategy == "skip":
                skipped += 1
                continue
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
                existing.update(updates)
            updated += 1
        else:
            new_id = str(uuid.uuid4())
            doc = {
                "id": new_id,
                "user_id": user_id,
                **clean_row,
                "source": "import",
                "favorite": False,
                "social_links": {},
                "created_at": now(),
                "updated_at": now(),
            }
            await db.contacts.insert_one(doc)
            if row_email:
                email_index[row_email] = doc
            digits = "".join(ch for ch in str(clean_row.get("phone") or "") if ch.isdigit())
            if len(digits) >= 7:
                phone_suffix_index.setdefault(digits[-10:], doc)
            imported += 1
    return {
        "total": len(rows),
        "imported": imported,
        "updated": updated,
        "duplicate_removed": skipped,
        "failed": failed,
    }
