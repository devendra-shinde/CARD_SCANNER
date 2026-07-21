"""Email templates CRUD."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import clean_doc, db, iso, now
from schemas import TemplateIn

router = APIRouter(tags=["templates"])


@router.get("/templates")
async def list_templates(user_id: str = Depends(get_current_user_id)):
    cur = db.templates.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "updated_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}


@router.post("/templates")
async def create_template(body: TemplateIn, user_id: str = Depends(get_current_user_id)):
    doc = body.model_dump()
    doc.update({"id": str(uuid.uuid4()), "user_id": user_id, "created_at": now(), "updated_at": now()})
    await db.templates.insert_one(doc)
    return clean_doc(dict(doc))


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user_id: str = Depends(get_current_user_id)):
    res = await db.templates.delete_one({"id": template_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return {"ok": True}
