"""Subscription tier + anti-spam quota rules."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Literal

Plan = Literal["free", "basic", "pro"]

# Days a fresh signup gets on the free trial.
FREE_TRIAL_DAYS = 14
FREE_DAILY_RECIPIENTS = 2
PAID_WEEKLY_PER_RECIPIENT = 3
ROLLING_WINDOW_DAYS = 7

PLANS: Dict[Plan, Dict[str, Any]] = {
    "free": {
        "name": "Free Trial",
        "price_monthly": 0,
        "price_yearly": 0,
        "daily_recipients": FREE_DAILY_RECIPIENTS,
        "features": ["scan", "contacts", "enrich"],
    },
    "basic": {
        "name": "Basic",
        "price_monthly": 100,
        "price_yearly": 1000,
        "daily_recipients": None,  # unlimited
        "features": ["scan", "contacts", "enrich", "email_campaign", "ai_email", "templates",
                     "attachments", "excel_import", "excel_export"],
    },
    "pro": {
        "name": "Pro",
        "price_monthly": 200,
        "price_yearly": 2000,
        "daily_recipients": None,
        "features": ["scan", "contacts", "enrich", "email_campaign", "ai_email", "templates",
                     "attachments", "excel_import", "excel_export", "whatsapp_campaign",
                     "whatsapp_templates"],
    },
}


def get_effective_plan(user: dict) -> Plan:
    """Return the plan the user should be treated as — considering trial expiry."""
    plan: Plan = (user.get("plan") or "free").lower()  # type: ignore
    if plan == "free":
        # Trial always active in dev. In prod, check trial_ends_at.
        return "free"
    # Paid plan — check subscription_current_period_end.
    end = user.get("subscription_current_period_end")
    if end and isinstance(end, datetime) and end < datetime.utcnow():
        return "free"
    return plan


def has_feature(user: dict, feature: str) -> bool:
    plan = get_effective_plan(user)
    return feature in PLANS[plan]["features"]


def free_daily_limit(user: dict) -> int | None:
    """Return the free-trial daily recipient cap, or None for unlimited."""
    plan = get_effective_plan(user)
    return PLANS[plan]["daily_recipients"]
