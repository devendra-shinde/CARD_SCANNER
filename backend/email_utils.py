"""SMTP email delivery for OTPs (system SMTP) and campaigns (per-user SMTP)."""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger("email")


def _build_message(sender: str, to: str, subject: str, html: str, text: Optional[str] = None) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    if text:
        msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


def send_smtp(
    host: str,
    port: int,
    username: str,
    password: str,
    from_addr: str,
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    use_tls: bool = True,
) -> tuple[bool, str]:
    """Return (ok, error_message_if_any)."""
    try:
        msg = _build_message(from_addr, to, subject, html, text)
        if port == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as srv:
                if username:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=20) as srv:
                srv.ehlo()
                if use_tls:
                    srv.starttls(context=ssl.create_default_context())
                    srv.ehlo()
                if username:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to], msg.as_string())
        return True, ""
    except Exception as e:
        logger.exception("SMTP send failed")
        return False, str(e)


def send_system_email(to: str, subject: str, html: str, text: Optional[str] = None) -> tuple[bool, str]:
    """Send using system SMTP credentials (for OTPs)."""
    host = os.environ.get("SYSTEM_SMTP_HOST", "").strip()
    if not host:
        logger.warning("SYSTEM SMTP not configured; email NOT actually sent. To=%s Subject=%s", to, subject)
        # In dev, we return success so signup flow works — the OTP is logged elsewhere.
        return True, "system_smtp_not_configured"
    port = int(os.environ.get("SYSTEM_SMTP_PORT", "587"))
    user = os.environ.get("SYSTEM_SMTP_USER", "")
    pwd = os.environ.get("SYSTEM_SMTP_PASS", "")
    from_addr = os.environ.get("SYSTEM_SMTP_FROM") or user
    return send_smtp(host, port, user, pwd, from_addr, to, subject, html, text)


def otp_email_html(otp: str, purpose: str = "verification") -> str:
    return f"""
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; background: #f8fafc;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
        <h1 style="margin: 0 0 8px 0; font-size: 24px; color: #0F172A;">CardVault</h1>
        <p style="margin: 0 0 24px 0; color: #64748B;">Your {purpose} code</p>
        <div style="font-size: 40px; font-weight: 700; letter-spacing: 6px; color: #0F172A; text-align: center; padding: 20px; background: #F8FAFC; border-radius: 12px;">
          {otp}
        </div>
        <p style="margin: 24px 0 0 0; color: #64748B; font-size: 14px;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
      </div>
    </div>
    """
