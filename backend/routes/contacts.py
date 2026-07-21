"""Contact CRUD + facets + duplicate detection + merge + recipient status."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import clean_doc, db, iso, normalize_tags, now
from plans import free_daily_limit, get_effective_plan
from schemas import ContactIn, ContactUpdate, MergeIn

router = APIRouter(tags=["contacts"])


@router.post("/contacts")
async def create_contact(body: ContactIn, user_id: str = Depends(get_current_user_id)):
    cid = str(uuid.uuid4())
    doc = body.model_dump()
    doc["tags"] = normalize_tags(doc.get("tags"))
    doc.update({
        "id": cid,
        "user_id": user_id,
        "created_at": now(),
        "updated_at": now(),
    })
    await db.contacts.insert_one(doc)
    return clean_doc(dict(doc))


@router.get("/contacts")
async def list_contacts(
    user_id: str = Depends(get_current_user_id),
    search: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[str] = None,
    industry: Optional[str] = None,
    company: Optional[str] = None,
    country: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    favorite: Optional[bool] = None,
    sort: str = "recent",
    limit: int = 500,
):
    q: Dict[str, Any] = {"user_id": user_id}

    def _multi(val: Optional[str]) -> Optional[List[str]]:
        if not val:
            return None
        parts = [v.strip() for v in str(val).split(",") if v.strip()]
        return parts or None

    tag_list = _multi(tags) or _multi(tag)
    if tag_list:
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
            {"name": rx}, {"company": rx}, {"email": rx},
            {"phone": rx}, {"designation": rx},
        ]
    sort_key = {"recent": ("created_at", -1), "name": ("name", 1), "company": ("company", 1)}.get(
        sort, ("created_at", -1)
    )
    cur = db.contacts.find(q, {"_id": 0}).sort(*sort_key).limit(limit)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items, "count": len(items)}


@router.get("/contacts/facets")
async def list_contact_facets(user_id: str = Depends(get_current_user_id)):
    facets: Dict[str, Any] = {}
    for field in ("country", "state", "city", "industry"):
        cur = db.contacts.aggregate([
            {"$match": {"user_id": user_id, field: {"$nin": ["", None]}}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 50},
        ])
        facets[field] = [{"value": d["_id"], "count": d["count"]} async for d in cur]
    cur = db.contacts.aggregate([
        {"$match": {"user_id": user_id}},
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ])
    facets["tag"] = [{"value": d["_id"], "count": d["count"]} async for d in cur if d["_id"]]
    return facets


@router.get("/contacts/duplicates")
async def find_duplicates(user_id: str = Depends(get_current_user_id)):
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
@router.get("/contacts/recipient-status")
async def recipient_status(user_id: str = Depends(get_current_user_id)):
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
    daily_sent = await db.campaign_history.count_documents(
        {"user_id": user_id, "status": "sent", "sent_at": {"$gte": today}}
    )
    cap = free_daily_limit(user)
    return {
        "items": items,
        "plan": plan,
        "daily_sent": daily_sent,
        "daily_cap": cap,
        "remaining_today": None if cap is None else max(0, cap - daily_sent),
    }


@router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.contacts.find_one({"id": contact_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Contact not found")
    for k in ("created_at", "updated_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc


@router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user_id: str = Depends(get_current_user_id)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    if "tags" in updates:
        updates["tags"] = normalize_tags(updates["tags"])
    updates["updated_at"] = now()
    res = await db.contacts.update_one({"id": contact_id, "user_id": user_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Contact not found")
    doc = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    for k in ("created_at", "updated_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = iso(doc[k])
    return doc


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.contacts.delete_one({"id": contact_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Contact not found")
    return {"ok": True}


@router.post("/contacts/merge")
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
