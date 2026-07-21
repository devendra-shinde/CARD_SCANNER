"""Aggregate dashboards — contact/campaign summaries and growth."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends

from auth_utils import get_current_user_id
from deps import db, now

router = APIRouter(tags=["analytics"])


@router.get("/analytics")
async def analytics(user_id: str = Depends(get_current_user_id)):
    contacts_count = await db.contacts.count_documents({"user_id": user_id})
    month_start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    scans_month = await db.contacts.count_documents(
        {"user_id": user_id, "source": "ocr", "created_at": {"$gte": month_start}}
    )
    campaigns_count = await db.campaigns.count_documents({"user_id": user_id})
    emails_sent = await db.campaign_history.count_documents({"user_id": user_id, "status": "sent"})

    industry_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "industry": {"$ne": ""}}},
        {"$group": {"_id": "$industry", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8},
    ])
    industries = [{"label": d["_id"] or "Unknown", "count": d["count"]} async for d in industry_agg]

    country_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "country": {"$ne": ""}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8},
    ])
    countries = [{"label": d["_id"] or "Unknown", "count": d["count"]} async for d in country_agg]

    thirty_days_ago = now() - timedelta(days=30)
    growth_agg = db.contacts.aggregate([
        {"$match": {"user_id": user_id, "created_at": {"$gte": thirty_days_ago}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ])
    growth = [{"date": d["_id"], "count": d["count"]} async for d in growth_agg]

    return {
        "contacts_total": contacts_count,
        "scans_this_month": scans_month,
        "campaigns_total": campaigns_count,
        "emails_sent": emails_sent,
        "industries": industries,
        "countries": countries,
        "growth": growth,
    }
