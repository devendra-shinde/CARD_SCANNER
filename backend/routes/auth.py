"""Authentication endpoints: email/password + OTP + Emergent Google."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException

from auth_utils import (
    generate_otp,
    get_current_user_id,
    hash_password,
    make_access_token,
    verify_password,
)
from deps import EMERGENT_SESSION_URL, db, iso, logger, now
from email_utils import otp_email_html, send_system_email
from schemas import (
    ForgotPwIn,
    GoogleSessionIn,
    LoginIn,
    ResendOtpIn,
    ResetPwIn,
    SignupIn,
    VerifyOtpIn,
)

router = APIRouter(tags=["auth"])


async def _issue_otp(email: str, purpose: str) -> tuple[str, bool]:
    """Create + persist an OTP. Returns (otp, dev_mode).

    dev_mode is True when no system SMTP is configured — callers should
    surface the OTP in the response so the preview app still works end-to-end.
    """
    otp = generate_otp(6)
    await db.otps.delete_many({"email": email, "purpose": purpose})
    await db.otps.insert_one({
        "email": email,
        "otp": otp,
        "purpose": purpose,
        "expires_at": now() + timedelta(minutes=10),
        "created_at": now(),
    })
    logger.info("OTP for %s (%s) = %s", email, purpose, otp)
    dev_mode = not (os.environ.get("SYSTEM_SMTP_HOST", "").strip())
    if not dev_mode:
        ok, err = send_system_email(
            to=email,
            subject=f"Your CardVault {purpose} code: {otp}",
            html=otp_email_html(otp, purpose),
            text=f"Your CardVault {purpose} code: {otp}. Expires in 10 minutes.",
        )
        if not ok:
            logger.warning("system email send failed for %s: %s", email, err)
    return otp, dev_mode


@router.get("/")
async def root():
    return {"service": "cardvault", "status": "ok"}


@router.post("/auth/signup")
async def signup(body: SignupIn):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        if existing.get("email_verified"):
            raise HTTPException(400, "Email already registered")
        otp, dev_mode = await _issue_otp(body.email.lower(), "signup")
        resp = {"message": "OTP re-sent", "email": body.email.lower()}
        if dev_mode:
            resp["dev_otp"] = otp
        return resp
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "name": body.name.strip(),
        "email": body.email.lower(),
        "password": hash_password(body.password),
        "organization": body.organization or "",
        "role": body.role or "",
        "email_verified": False,
        "created_at": now(),
        "updated_at": now(),
    }
    await db.users.insert_one(doc)
    otp, dev_mode = await _issue_otp(body.email.lower(), "signup")
    resp = {"message": "OTP sent to email", "email": body.email.lower()}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@router.post("/auth/verify-otp")
async def verify_otp(body: VerifyOtpIn):
    row = await db.otps.find_one({"email": body.email.lower(), "purpose": "signup"})
    if not row or row["otp"] != body.otp:
        raise HTTPException(400, "Invalid OTP")
    if row["expires_at"] < now():
        raise HTTPException(400, "OTP expired")
    await db.otps.delete_one({"_id": row["_id"]})
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True, "updated_at": now()}})
    token = make_access_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "organization": user.get("organization", ""),
            "role": user.get("role", ""),
            "email_verified": True,
            "created_at": iso(user["created_at"]),
        },
    }


@router.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password"]):
        raise HTTPException(401, "Invalid credentials")
    if not user.get("email_verified"):
        otp, dev_mode = await _issue_otp(user["email"], "signup")
        detail: Any = "Email not verified. OTP re-sent."
        if dev_mode:
            raise HTTPException(status_code=403, detail={"message": detail, "dev_otp": otp})
        raise HTTPException(403, detail)
    token = make_access_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "organization": user.get("organization", ""),
            "role": user.get("role", ""),
            "email_verified": True,
            "created_at": iso(user["created_at"]),
        },
    }


@router.post("/auth/resend-otp")
async def resend_otp(body: ResendOtpIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    otp, dev_mode = await _issue_otp(user["email"], "signup")
    resp: Dict[str, Any] = {"message": "OTP re-sent"}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPwIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        return {"message": "If the email exists, a reset code has been sent."}
    otp, dev_mode = await _issue_otp(user["email"], "reset")
    resp: Dict[str, Any] = {"message": "Reset code sent"}
    if dev_mode:
        resp["dev_otp"] = otp
    return resp


@router.post("/auth/reset-password")
async def reset_password(body: ResetPwIn):
    row = await db.otps.find_one({"email": body.email.lower(), "purpose": "reset"})
    if not row or row["otp"] != body.otp:
        raise HTTPException(400, "Invalid OTP")
    if row["expires_at"] < now():
        raise HTTPException(400, "OTP expired")
    await db.otps.delete_one({"_id": row["_id"]})
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        raise HTTPException(404, "User not found")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password": hash_password(body.new_password), "updated_at": now()}},
    )
    return {"message": "Password reset successfully"}


@router.get("/auth/me")
async def me(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(404, "User not found")
    for k in ("created_at", "updated_at"):
        if isinstance(user.get(k), datetime):
            user[k] = iso(user[k])
    return user


@router.post("/auth/google-session")
async def google_session(body: GoogleSessionIn):
    """Emergent-managed Google Sign-In callback.

    Frontend calls this with the session_id returned from Emergent's auth flow.
    We verify with Emergent, upsert a user by email, then issue our own JWT so
    the rest of the app (contacts, campaigns, etc.) keeps using one auth scheme.
    """
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
        if r.status_code != 200:
            raise HTTPException(401, f"Session not recognised ({r.status_code})")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Auth provider unreachable: {e}")

    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(400, "No email in session data")
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture") or ""

    user = await db.users.find_one({"email": email})
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id,
            "name": name,
            "email": email,
            "password": "",
            "organization": "",
            "role": "",
            "email_verified": True,
            "provider": "google",
            "avatar_url": picture,
            "created_at": now(),
            "updated_at": now(),
        }
        await db.users.insert_one(dict(user))
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "email_verified": True,
            "avatar_url": picture or user.get("avatar_url", ""),
            "provider": user.get("provider") or "google",
            "updated_at": now(),
        }})

    token = make_access_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "organization": user.get("organization", ""),
            "role": user.get("role", ""),
            "email_verified": True,
            "avatar_url": picture or user.get("avatar_url", ""),
            "provider": "google",
            "created_at": iso(user["created_at"]) if isinstance(user.get("created_at"), datetime) else user.get("created_at", ""),
        },
    }
