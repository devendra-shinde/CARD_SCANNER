"""Subscription + Razorpay-driven billing.

Razorpay endpoints intentionally return 503 until the operator provides
`RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` in backend/.env. The client can
call /billing/status regardless and get plan / quota info.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from auth_utils import get_current_user_id
from deps import db, iso, logger, now
from plans import FREE_TRIAL_DAYS, PLANS, free_daily_limit, get_effective_plan
from schemas import CheckoutIn, VerifyPaymentIn

router = APIRouter(tags=["billing"])


@router.get("/billing/status")
async def billing_status(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}) or {}
    plan = get_effective_plan(user)
    today_start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_sent = await db.campaign_history.count_documents(
        {"user_id": user_id, "status": "sent", "sent_at": {"$gte": today_start}}
    )
    daily_cap = free_daily_limit(user)
    return {
        "plan": plan,
        "plan_details": PLANS[plan],
        "trial_days": FREE_TRIAL_DAYS,
        "daily_sent": daily_sent,
        "daily_cap": daily_cap,
        "remaining_today": (None if daily_cap is None else max(0, daily_cap - daily_sent)),
        "subscription_current_period_end": iso(user["subscription_current_period_end"])
            if isinstance(user.get("subscription_current_period_end"), datetime) else None,
        "razorpay_configured": bool(os.environ.get("RAZORPAY_KEY_ID")),
    }


@router.post("/billing/checkout")
async def billing_checkout(body: CheckoutIn, user_id: str = Depends(get_current_user_id)):
    if body.plan not in ("basic", "pro") or body.cycle not in ("monthly", "yearly"):
        raise HTTPException(400, "Invalid plan or cycle")
    key_id = os.environ.get("RAZORPAY_KEY_ID", "")
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not key_id or not key_secret:
        raise HTTPException(
            503,
            "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env.",
        )
    try:
        import razorpay  # type: ignore
        rz = razorpay.Client(auth=(key_id, key_secret))
        amount = PLANS[body.plan]["price_" + body.cycle] * 100  # paise
        order = rz.order.create({
            "amount": amount,
            "currency": "INR",
            "receipt": f"cv_{user_id[:8]}_{int(datetime.utcnow().timestamp())}",
            "notes": {"user_id": user_id, "plan": body.plan, "cycle": body.cycle},
        })
        await db.billing_orders.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "order_id": order["id"],
            "plan": body.plan,
            "cycle": body.cycle,
            "amount": amount,
            "status": "created",
            "created_at": now(),
        })
        return {"order_id": order["id"], "amount": amount, "currency": "INR", "key_id": key_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("razorpay checkout failed")
        raise HTTPException(500, f"Checkout failed: {e}")


@router.post("/billing/verify")
async def billing_verify(body: VerifyPaymentIn, user_id: str = Depends(get_current_user_id)):
    key_secret = os.environ.get("RAZORPAY_KEY_SECRET", "")
    if not key_secret:
        raise HTTPException(503, "Razorpay not configured")
    try:
        import razorpay  # type: ignore
        rz = razorpay.Client(auth=(os.environ["RAZORPAY_KEY_ID"], key_secret))
        rz.utility.verify_payment_signature({
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
        })
    except Exception as e:
        raise HTTPException(400, f"Invalid payment signature: {e}")
    period_days = 30 if body.cycle == "monthly" else 365
    period_end = now() + timedelta(days=period_days)
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": body.plan,
        "subscription_cycle": body.cycle,
        "subscription_id": body.razorpay_payment_id,
        "subscription_current_period_end": period_end,
        "updated_at": now(),
    }})
    await db.billing_orders.update_one(
        {"order_id": body.razorpay_order_id},
        {"$set": {"status": "paid", "payment_id": body.razorpay_payment_id, "paid_at": now()}},
    )
    return {"ok": True, "plan": body.plan, "period_end": iso(period_end)}


@router.post("/billing/cancel")
async def billing_cancel(user_id: str = Depends(get_current_user_id)):
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": "free",
        "subscription_current_period_end": None,
        "updated_at": now(),
    }})
    return {"ok": True}


@router.get("/billing/history")
async def billing_history(user_id: str = Depends(get_current_user_id)):
    cur = db.billing_orders.find({"user_id": user_id, "status": "paid"}, {"_id": 0}).sort("paid_at", -1)
    items = []
    async for d in cur:
        for k in ("created_at", "paid_at"):
            if isinstance(d.get(k), datetime):
                d[k] = iso(d[k])
        items.append(d)
    return {"items": items}
